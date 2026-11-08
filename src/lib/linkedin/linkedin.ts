/**
 * LinkedIn publishing (Phase 5) — official Posts API via 3-legged OAuth 2.0.
 * Contracts verified against the current docs (learn.microsoft.com, Nov 2026):
 *
 * - Authorize: GET https://www.linkedin.com/oauth/v2/authorization
 *     (response_type=code, client_id, redirect_uri, state, scope)
 * - Token exchange / refresh: POST https://www.linkedin.com/oauth/v2/accessToken
 *     (x-www-form-urlencoded)
 * - Member identity (Sign In with LinkedIn using OpenID Connect):
 *     GET https://api.linkedin.com/v2/userinfo → `sub` → urn:li:person:{sub}.
 *     Scopes: openid profile w_member_social. Changing scopes invalidates
 *     previously granted tokens (authorization-code-flow docs, step 3 note).
 * - Create post: POST https://api.linkedin.com/rest/posts
 *     headers: Authorization: Bearer, X-Restli-Protocol-Version: 2.0.0,
 *              Linkedin-Version: YYYYMM (2026-10 docs → "202610"), Content-Type
 *     → 201, post URN in the x-restli-id response header
 * - Link preview: content.article { source (required URL), title (required,
 *     <400 chars), description (optional) } — the API does not scrape URLs,
 *     so the caller supplies these; thumbnail is optional and omitted here.
 *
 * Tokens live OUTSIDE the repo (~/.secptile/linkedin.json, mode 0600) — never
 * committed, never sent to the client. Programmatic refresh tokens are a
 * limited-partner feature: expiry always means "run the OAuth flow again".
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

/** Docs: OIDC sign-in — openid+profile identify the member; posting is w_member_social. */
export const LINKEDIN_SCOPES = [
  "openid",
  "profile",
  "w_member_social",
];

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

/** GET /v2/userinfo → sub → urn:li:person:{sub} (docs: OIDC sign-in). */
async function fetchMemberUrn(accessToken: string): Promise<string> {
  const response = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const detail = (await response.text()).split("\n")[0]?.trim();
    throw new LinkedInError(
      `Could not read your LinkedIn identity (/v2/userinfo ${response.status})${detail ? `: ${detail}` : ""}.`,
      502,
      response.status === 401 || response.status === 403,
    );
  }
  const json: unknown = await response.json();
  const sub =
    typeof json === "object" && json !== null && "sub" in json
      ? (json as { sub: unknown }).sub
      : null;
  if (typeof sub !== "string" || !sub) {
    throw new LinkedInError(
      "LinkedIn userinfo response was malformed (missing sub).",
      502,
      true,
    );
  }
  return `urn:li:person:${sub}`;
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

/**
 * Link preview for the live blog post (docs: Post Schema / Article content).
 * The API does not scrape URLs — source and title are required inputs and
 * `description`/`thumbnail` are optional; thumbnail stays omitted here.
 */
export type LinkedInArticle = {
  url: string;
  /** Blog post title, <400 chars (Post Schema). */
  title: string;
  /** Optional (<4086 chars per the Article schema). */
  description?: string;
};

export type LinkedInPostResult = {
  /** e.g. urn:li:share:684478… — from the 201 response's x-restli-id header. */
  postUrn: string | null;
};

/**
 * Exactly one of `article` / `image` may be set. Image flow (docs: Images API,
 * li-lms-2026-10): POST /rest/images?action=initializeUpload → value.uploadUrl
 * + value.image URN; PUT the raw bytes to that URL WITH the OAuth header
 * (image uploads, unlike video, require the Authorization header); then create
 * the post with content.media.id = the image URN. Formats: JPEG/PNG/GIF only.
 */
export type LinkedInPostOptions = {
  article?: LinkedInArticle;
  image?: {
    bytes: Uint8Array;
    mime: string;
    /** ≤120 chars recommended (schema allows 4086). */
    altText: string;
  };
};

type ImageInitResponse = {
  value?: { uploadUrl?: string; image?: string };
};

/**
 * Register + upload an image and return its urn:li:image:… URN.
 * Owner is the member — w_member_social tokens are write-only on rest/images,
 * which is exactly what this flow does (docs: permissions).
 */
async function uploadImage(
  record: LinkedInTokenRecord,
  apiVersion: string,
  image: NonNullable<LinkedInPostOptions["image"]>,
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${record.accessToken}`,
    "Content-Type": "application/json",
    "X-Restli-Protocol-Version": "2.0.0",
    "Linkedin-Version": apiVersion,
  };

  const init = await fetch(
    "https://api.linkedin.com/rest/images?action=initializeUpload",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        initializeUploadRequest: { owner: record.memberUrn },
      }),
    },
  );
  if (!init.ok) {
    const detail = (await init.text()).split("\n")[0]?.trim();
    throw new LinkedInError(
      `Could not register the photo upload (${init.status}${detail ? `: ${detail}` : ""}).`,
      502,
      init.status === 401,
    );
  }
  const initJson: unknown = await init.json().catch(() => null);
  const uploadUrl =
    (initJson as ImageInitResponse | null)?.value?.uploadUrl ?? null;
  const imageUrn = (initJson as ImageInitResponse | null)?.value?.image ?? null;
  if (!uploadUrl || !imageUrn) {
    throw new LinkedInError(
      "LinkedIn's upload registration response was malformed (missing uploadUrl/image).",
      502,
    );
  }

  const upload = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${record.accessToken}`,
      "Content-Type": image.mime,
    },
    body: new Uint8Array(image.bytes),
  });
  if (!upload.ok) {
    const detail = (await upload.text()).split("\n")[0]?.trim();
    throw new LinkedInError(
      `Uploading the photo failed (${upload.status}${detail ? `: ${detail}` : ""}).`,
      502,
    );
  }
  return imageUrn;
}

/**
 * Create a member post via POST /rest/posts — plain text, optionally with a
 * link-preview article or an attached image. Only ever called with text the
 * owner explicitly approved (hard rule 1 — enforced in the route).
 */
export async function postToLinkedIn(
  text: string,
  visibility: PostVisibility,
  options: LinkedInPostOptions = {},
): Promise<LinkedInPostResult> {
  const record = await getAccessToken();
  const { apiVersion } = config();

  const payload: Record<string, unknown> = {
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
  };
  if (options.image) {
    const mediaUrn = await uploadImage(record, apiVersion, options.image);
    payload.content = { media: { id: mediaUrn, altText: options.image.altText } };
  } else if (options.article) {
    payload.content = {
      article: {
        source: options.article.url,
        title: options.article.title,
        ...(options.article.description
          ? { description: options.article.description }
          : {}),
      },
    };
  }

  const response = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${record.accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "Linkedin-Version": apiVersion,
    },
    body: JSON.stringify(payload),
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
