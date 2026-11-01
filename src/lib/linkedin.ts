/**
 * LinkedIn publishing (Phase 5) — official Posts API via 3-legged OAuth 2.0.
 * Contracts verified against the current docs (learn.microsoft.com, Nov 2026):
 *
 * - Authorize: GET https://www.linkedin.com/oauth/v2/authorization
 *     (response_type=code, client_id, redirect_uri, state, scope)
 * - Token exchange / refresh: POST https://www.linkedin.com/oauth/v2/accessToken
 *     (x-www-form-urlencoded)
 * - Member identity: GET https://api.linkedin.com/v2/me → id → urn:li:person:{id}
 *     (needs r_basicprofile)
 * - Create post: POST https://api.linkedin.com/rest/posts
 *     headers: Authorization: Bearer, X-Restli-Protocol-Version: 2.0.0,
 *              Linkedin-Version: YYYYMM (e.g. 202610), Content-Type: application/json
 *     → 201, post URN in the x-restli-id response header
 *
 * Tokens live OUTSIDE the repo (~/.secptile/linkedin.json, mode 0600) — never
 * committed, never sent to the client.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export class LinkedInError extends Error {
  readonly status: number;
  /** True when the fix requires running the OAuth flow again. */
  readonly needsReauth: boolean;
  constructor(message: string, status = 500, needsReauth = false) {
    super(message);
    this.name = "LinkedInError";
    this.status = status;
    this.needsReauth = needsReauth;
  }
}

export type LinkedInTokenRecord = {
  accessToken: string;
  /** Unix ms when the access token dies (~60 days after issue). */
  expiresAt: number;
  refreshToken?: string;
  refreshTokenExpiresAt?: number;
  scope: string;
  memberUrn: string;
};

export type LinkedInStatus = {
  configured: boolean;
  connected: boolean;
  /** ISO time when the token expires, when connected. */
  expiresAt: string | null;
};

export const LINKEDIN_SCOPES = ["r_basicprofile", "w_member_social"];

/** Versions track the docs' li-lms-YYYY-MM monikers; 2026-10 is current. */
const DEFAULT_API_VERSION = "202610";

function config() {
  const clientId = process.env.LINKEDIN_CLIENT_ID?.trim();
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.LINKEDIN_REDIRECT_URI?.trim() ||
    "http://localhost:3000/api/auth/linkedin/callback";
  const apiVersion =
    process.env.LINKEDIN_API_VERSION?.trim() || DEFAULT_API_VERSION;
  const tokenFile =
    process.env.LINKEDIN_TOKEN_FILE?.trim() ||
    path.join(homedir(), ".secptile", "linkedin.json");
  return { clientId, clientSecret, redirectUri, apiVersion, tokenFile };
}

export function linkedinConfigured(): boolean {
  const { clientId, clientSecret } = config();
  return Boolean(clientId && clientSecret);
}

function tokenFile(): string {
  return config().tokenFile;
}

export async function readTokenRecord(): Promise<LinkedInTokenRecord | null> {
  try {
    const raw = await readFile(tokenFile(), "utf8");
    const record = JSON.parse(raw) as LinkedInTokenRecord;
    if (!record.accessToken || !record.memberUrn) return null;
    return record;
  } catch {
    return null;
  }
}

async function writeTokenRecord(record: LinkedInTokenRecord): Promise<void> {
  const file = tokenFile();
  await mkdir(path.dirname(file), { recursive: true });
  // 0600 — the owner only, no secrets readable by group/others.
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}

export async function linkedinStatus(): Promise<LinkedInStatus> {
  const record = await readTokenRecord();
  return {
    configured: linkedinConfigured(),
    connected: Boolean(record),
    expiresAt: record ? new Date(record.expiresAt).toISOString() : null,
  };
}

export function authorizeUrl(state: string): string {
  const { clientId, redirectUri } = config();
  if (!clientId) {
    throw new LinkedInError("LINKEDIN_CLIENT_ID is not configured.", 500);
  }
  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  // Scope: space-delimited, urlencoded by searchParams.
  url.searchParams.set("scope", LINKEDIN_SCOPES.join(" "));
  return url.toString();
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope: string;
};

async function tokenRequest(
  body: Record<string, string>,
  failure: string,
): Promise<TokenResponse> {
  const { clientId, clientSecret } = config();
  const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId ?? "",
      client_secret: clientSecret ?? "",
      ...body,
    }).toString(),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof json !== "object" || json === null) {
    const message =
      typeof json === "object" && json !== null && "error_description" in json
        ? String((json as { error_description: unknown }).error_description)
        : `LinkedIn returned ${response.status}`;
    throw new LinkedInError(`${failure}: ${message}`, 502, true);
  }
  const token = json as TokenResponse;
  if (!token.access_token || !token.expires_in) {
    throw new LinkedInError(`${failure}: malformed token response.`, 502, true);
  }
  return token;
}

/** GET /v2/me → id → urn:li:person:{id} (docs: Profile API). */
async function fetchMemberUrn(accessToken: string): Promise<string> {
  const response = await fetch("https://api.linkedin.com/v2/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const detail = (await response.text()).split("\n")[0]?.trim();
    throw new LinkedInError(
      `Could not read your LinkedIn identity (/v2/me ${response.status})${detail ? `: ${detail}` : ""}.`,
      502,
      response.status === 401 || response.status === 403,
    );
  }
  const json: unknown = await response.json();
  const id =
    typeof json === "object" && json !== null && "id" in json
      ? (json as { id: unknown }).id
      : null;
  if (typeof id !== "string" || !id) {
    throw new LinkedInError("LinkedIn profile response was malformed.", 502, true);
  }
  return `urn:li:person:${id}`;
}

/** Exchange the OAuth code for tokens, resolve the member URN, store it. */
export async function exchangeCode(code: string): Promise<LinkedInTokenRecord> {
  const { redirectUri } = config();
  const token = await tokenRequest(
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    },
    "LinkedIn token exchange failed",
  );
  const record: LinkedInTokenRecord = {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    refreshToken: token.refresh_token,
    refreshTokenExpiresAt: token.refresh_token_expires_in
      ? Date.now() + token.refresh_token_expires_in * 1000
      : undefined,
    scope: token.scope,
    memberUrn: await fetchMemberUrn(token.access_token),
  };
  await writeTokenRecord(record);
  return record;
}

/** Refresh-token grant — only works if LinkedIn granted the app that feature. */
async function refreshRecord(record: LinkedInTokenRecord): Promise<LinkedInTokenRecord> {
  const token = await tokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: record.refreshToken ?? "",
    },
    "LinkedIn token refresh failed",
  );
  const refreshed: LinkedInTokenRecord = {
    ...record,
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    refreshToken: token.refresh_token ?? record.refreshToken,
    refreshTokenExpiresAt: token.refresh_token_expires_in
      ? Date.now() + token.refresh_token_expires_in * 1000
      : record.refreshTokenExpiresAt,
  };
  await writeTokenRecord(refreshed);
  return refreshed;
}

/**
 * Return an access token that still works (refresh margin 24h so a token
 * expiring today is treated as expiring — a post you queued must not 401).
 */
async function getAccessToken(): Promise<LinkedInTokenRecord> {
  const record = await readTokenRecord();
  if (!record) {
    throw new LinkedInError(
      "LinkedIn is not connected yet — run the OAuth flow first.",
      400,
      true,
    );
  }
  if (Date.now() < record.expiresAt - 24 * 60 * 60 * 1000) {
    return record;
  }
  const hasRefresh =
    record.refreshToken &&
    record.refreshTokenExpiresAt &&
    Date.now() < record.refreshTokenExpiresAt;
  if (!hasRefresh) {
    throw new LinkedInError(
      "LinkedIn access expired — reconnect via the OAuth flow.",
      401,
      true,
    );
  }
  try {
    return await refreshRecord(record);
  } catch (error) {
    if (error instanceof LinkedInError) {
      throw new LinkedInError(
        `${error.message} Reconnect via the OAuth flow.`,
        error.status,
        true,
      );
    }
    throw error;
  }
}

export type PostVisibility = "PUBLIC" | "CONNECTIONS";

export type LinkedInPostResult = {
  /** e.g. urn:li:share:684478… — from the 201 response's x-restli-id header. */
  postUrn: string | null;
};

/**
 * Create a text-only member post via POST /rest/posts. Only ever called with
 * text the owner explicitly approved (hard rule 1 — enforced in the route).
 */
export async function postToLinkedIn(
  text: string,
  visibility: PostVisibility,
): Promise<LinkedInPostResult> {
  const record = await getAccessToken();
  const { apiVersion } = config();

  const response = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${record.accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "Linkedin-Version": apiVersion,
    },
    body: JSON.stringify({
      // Schema (post-api-schema): author is create-only required.
      author: record.memberUrn,
      commentary: text,
      visibility,
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).split("\n")[0]?.trim();
    const reauth = response.status === 401 || response.status === 403;
    const hint =
      response.status === 403 && detail?.includes("ACCESS_DENIED")
        ? " — your LinkedIn app needs the w_member_social product approved"
        : "";
    throw new LinkedInError(
      `LinkedIn rejected the post (${response.status})${hint}${detail ? `: ${detail}` : ""}`,
      response.status === 429 ? 429 : 502,
      reauth,
    );
  }

  return { postUrn: response.headers.get("x-restli-id") };
}
