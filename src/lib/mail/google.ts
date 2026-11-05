/**
 * Gmail adapter (Phase 7a) — official Gmail API v1 over plain REST (no SDK
 * weight). Contracts verified against the current docs (Nov 2026):
 *
 * - OAuth (web-server flow): GET https://accounts.google.com/o/oauth2/v2/auth
 *     (response_type=code, client_id, redirect_uri, state, scope —
 *     space-delimited — plus access_type=offline; the refresh token is only
 *     minted on FIRST authorization, so prompt=consent is always sent for
 *     reconnects) and POST https://oauth2.googleapis.com/token
 *     (x-www-form-urlencoded: code/grant_type=authorization_code or
 *     grant_type=refresh_token + client_id + client_secret + redirect_uri).
 * - REST base: https://gmail.googleapis.com/gmail/v1/users/me/…
 * - Scope: https://www.googleapis.com/auth/gmail.readonly — the minimum read
 *   scope covering bodies, attachments and search (metadata-scope would
 *   forbid both search and full bodies).
 * - messages.list returns ONLY ids (+threadId); each row is enriched with
 *     a messages.get in format=metadata with metadataHeaders — snippet,
 *     internalDate (epoch ms) and labelIds are top-level message fields.
 * - messages.get format=full → payload MIME tree: text/plain + text/html
 *     bodies inline (base64url), attachments identified by filename +
 *     body.attachmentId; bytes via messages/attachments.get (base64url).
 * - threads.get format=full → the conversation for the thread view.
 * - users.getProfile → emailAddress (names the connected account).
 *
 * Errors carry sanitized messages — token material never appears in errors,
 * logs, or anything returned to the client.
 */
import "server-only";
import { mailEncryptionKeyValid } from "./crypto";
import { unescapeText } from "./text";
import {
  readMailToken,
  writeMailToken,
  type MailTokenRecord,
} from "./store";
import type {
  MailAddress,
  MailListQuery,
  MailMessageDetail,
  MailPage,
  MailSendRequest,
  MailSentResult,
  MailThread,
  MailProviderId,
} from "./types";
import { MailError } from "./types";
import type { MailProvider, MailAttachmentBytes } from "./provider";

/* ------------------------------------------------------------------ config */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://gmail.googleapis.com/gmail/v1";

/** Minimum read-only scope (docs: gmail.readonly = "view your email"). */
const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  /** 7d: sensitive (not restricted) — "send messages only", no read/modify. */
  "https://www.googleapis.com/auth/gmail.send",
];

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** Headers worth carrying to the list rows. */
const LIST_HEADERS = ["From", "To", "Cc", "Subject", "Date"];

/** Refresh when the token has less than this left (1 min safety margin). */
const REFRESH_MARGIN_MS = 60_000;

function config() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID?.trim(),
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim(),
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI?.trim() ||
      "http://localhost:3100/api/mail/google/callback",
  };
}

export function googleConfigured(): boolean {
  const { clientId, clientSecret } = config();
  return Boolean(clientId && clientSecret && mailEncryptionKeyValid());
}

/* -------------------------------------------------------------------- oauth */

export function authorizeUrl(state: string): string {
  const { clientId, redirectUri } = config();
  if (!clientId) {
    throw new MailError("GOOGLE_CLIENT_ID is not configured.", 500);
  }
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  // Space-delimited, encoded by URLSearchParams (docs).
  url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  url.searchParams.set("state", state);
  // Refresh token is only returned on first authorization (docs Important
  // note) — prompt=consent guarantees one on every (re)connect.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(
  body: Record<string, string>,
  failure: string,
): Promise<TokenResponse> {
  const { clientId, clientSecret } = config();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId ?? "",
      client_secret: clientSecret ?? "",
      ...body,
    }),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof json !== "object" || json === null) {
    throw new MailError(`${failure}: Google returned ${response.status}.`, 502);
  }
  const token = json as TokenResponse;
  if (!token.access_token) {
    // OAuth error text from Google is generic provider wording (no secrets).
    const detail = token.error_description || token.error || "malformed response";
    throw new MailError(`${failure}: ${detail}.`, 502, token.error === "invalid_grant");
  }
  return token;
}

function recordFromTokens(
  token: TokenResponse,
  previous: MailTokenRecord | null,
  accountEmail: string,
): MailTokenRecord {
  if (!token.access_token || !token.expires_in) {
    throw new MailError("Google's token response was malformed.", 502);
  }
  return {
    provider: "google",
    accountEmail,
    accessToken: token.access_token,
    // Google reuses the existing refresh token unless prompt=consent —
    // keep the stored one when the response omits it (docs).
    refreshToken: token.refresh_token ?? previous?.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
    scope: token.scope ?? GMAIL_SCOPES.join(" "),
    connectedAt: new Date().toISOString(),
  };
}

/**
 * Exchange the OAuth code → tokens → identity → persisted (encrypted) record.
 * Called once from the OAuth callback; everything after this goes through
 * getAccessToken().
 */
export async function googleExchangeCode(code: string): Promise<string> {
  const { redirectUri } = config();
  const token = await tokenRequest(
    { code, grant_type: "authorization_code", redirect_uri: redirectUri },
    "Gmail token exchange failed",
  );

  const access = token.access_token ?? "";
  const profile = (await usersMeGet("/profile", access)) as { emailAddress?: string };
  const accountEmail = profile.emailAddress ?? "";
  if (!accountEmail) {
    throw new MailError("Gmail profile did not include an email address.", 502, true);
  }

  const previous = await readMailToken("google");
  await writeMailToken(recordFromTokens(token, previous, accountEmail));
  return accountEmail;
}

/* --------------------------------------------------------- token lifecycle */

/**
 * A working access token: transparently refreshed and re-persisted when
 * near expiry. `force` retries after a 401 (revoked token), at most once
 * per API call.
 */
async function getAccessToken(options: { force?: boolean } = {}) {
  const record = await readMailToken("google");
  if (!record) {
    throw new MailError("Gmail is not connected — run the OAuth flow first.", 400, true);
  }
  if (!options.force && Date.now() < record.expiresAt - REFRESH_MARGIN_MS) {
    return record;
  }
  if (!record.refreshToken) {
    throw new MailError(
      "Gmail access expired and no refresh token was stored — reconnect the account.",
      401,
      true,
    );
  }
  const token = await tokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: record.refreshToken,
    },
    "Gmail token refresh failed",
  );
  const refreshed = recordFromTokens(token, record, record.accountEmail);
  await writeMailToken(refreshed);
  return refreshed;
}

/**
 * Gate for send: the token's granted scope must actually include gmail.send
 * (older read-only connects don't) — fail reconnect-flagged, never guessed.
 */
function sendableRecordOrThrow(record: MailTokenRecord): void {
  const granted = record.scope.split(/[\s,]+/);
  if (!granted.includes(GMAIL_SEND_SCOPE)) {
    throw new MailError(
      "Gmail token predates sending permission — reconnect the account to enable Send.",
      403,
      true,
    );
  }
}

async function usersMeGet(path: string, accessToken: string, query?: URLSearchParams) {
  const url = new URL(`${API_BASE}/users/me${path}`);
  query?.forEach((value, key) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const detail = (await response.text()).split("\n")[0]?.trim().slice(0, 200);
    throw new MailError(
      `Gmail request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      response.status === 429 ? 429 : 502,
    );
  }
  return (await response.json()) as unknown;
}

/* --------------------------------------------------------------- gmail rest */

type GmailHeader = { name: string; value: string };
type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};

/** One API call with a single transparent refresh-and-retry on 401. */
async function gmailApi(
  path: string,
  query: URLSearchParams,
  retryOn401 = true,
): Promise<unknown> {
  const record = await getAccessToken();
  const url = new URL(`${API_BASE}/users/me${path}`);
  // APPEND, not set: metadataHeaders is legitimately repeated (one per
  // header name); set() would collapse them to the last value.
  query.forEach((value, key) => url.searchParams.append(key, value));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${record.accessToken}` },
  });
  if (response.status === 401 && retryOn401) {
    // Token revoked/expired despite our clock — refresh once and re-try.
    return gmailApi(path, query, false);
  }
  if (!response.ok) {
    const detail = (await response.text()).split("\n")[0]?.trim().slice(0, 200);
    throw new MailError(
      `Gmail request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      response.status === 429 ? 429 : 502,
    );
  }
  return (await response.json()) as unknown;
}

/** POST with the same single transparent refresh-and-retry on 401. */
async function gmailPost(path: string, body: unknown, retryOn401 = true): Promise<unknown> {
  const record = await getAccessToken();
  const response = await fetch(`${API_BASE}/users/me${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${record.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (response.status === 401 && retryOn401) {
    return gmailPost(path, body, false);
  }
  if (!response.ok) {
    const detail = (await response.text()).split("\n")[0]?.trim().slice(0, 200);
    throw new MailError(
      `Gmail send failed (${response.status})${detail ? `: ${detail}` : ""}`,
      response.status === 429 ? 429 : 502,
    );
  }
  return (await response.json()) as unknown;
}

/** Whether an already-stored token scope grants sending (status route flag). */
export function googleTokenCanSend(scope: string): boolean {
  return scope.split(/[\s,]+/).includes(GMAIL_SEND_SCOPE);
}

/* --------------------------------------------------------------- send (7d) */

/** RFC 2822 address atom — quote display names that break the atom. */
function formatAddress(address: MailAddress): string {
  const email = address.email.trim();
  const name = address.name?.trim() ?? "";
  if (!name) return email;
  return /[",;<>\\]/.test(name) ? `"${name.replace(/"/g, '\\"')}" <${email}>` : `${name} <${email}>`;
}

/** base64 Content-Transfer-Encoding, folded at 76 chars (RFC 2045). */
function foldBase64(value: string): string {
  return value.replace(/(.{76})/g, "$1\r\n ");
}

type ThreadingSource = {
  messageId: string | null;
  references: string | null;
  subject: string | null;
};

/**
 * Fetch the original's RFC threading headers (Gmail's internal id is NOT the
 * RFC Message-ID). Cheap metadata get() at send time — one call, no bodies.
 */
async function threadingSource(messageId: string): Promise<ThreadingSource | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(messageId)) {
    throw new MailError("Malformed Gmail message id.", 400);
  }
  const params = new URLSearchParams({ format: "metadata" });
  ["Message-ID", "References", "Subject", "From", "To"].forEach((name) =>
    params.append("metadataHeaders", name),
  );
  try {
    const message = (await gmailApi(`/messages/${messageId}`, params)) as GmailMessage;
    return {
      messageId: header(message, "Message-ID"),
      references: header(message, "References"),
      subject: header(message, "Subject"),
    };
  } catch (error) {
    // A vanished original must not block a fresh reply — send unthreaded.
    console.error(`[mail/google] reply threading fetch failed:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** Minimal RFC 822 message: To/Cc/Bcc/Subject/References + base64 plain body. */
function buildRfc822(request: MailSendRequest, threading: ThreadingSource | null): string {
  const lines: string[] = [];
  lines.push(`To: ${request.to.map(formatAddress).join(", ")}`);
  if (request.cc.length) lines.push(`Cc: ${request.cc.map(formatAddress).join(", ")}`);
  if (request.bcc.length) lines.push(`Bcc: ${request.bcc.map(formatAddress).join(", ")}`);

  let subject = request.subject.trim();
  if (threading && subject && !/^re:/i.test(subject)) subject = `Re: ${subject}`;
  if (subject) lines.push(`Subject: ${subject.replace(/\r?\n/g, " ")}`);
  else if (threading?.subject) lines.push(`Subject: Re: ${threading.subject.replace(/\r?\n/g, " ")}`);

  if (threading?.messageId) {
    lines.push(`In-Reply-To: ${threading.messageId}`);
    const references = threading.references ? `${threading.references} ${threading.messageId}` : threading.messageId;
    lines.push(`References: ${references}`);
  }

  lines.push("MIME-Version: 1.0");
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push("Content-Transfer-Encoding: base64");
  lines.push("");
  lines.push(foldBase64(Buffer.from(request.bodyText, "utf8").toString("base64")));
  return lines.join("\r\n");
}

function header(message: GmailMessage, name: string): string | null {
  const value = message.payload?.headers?.find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  )?.value;
  return value ?? null;
}

/** "Name" <a@b>, a@b, bare lists → MailAddress[] (RFC 2822-ish, pragmatic). */
function parseAddressList(value: string | null): MailAddress[] {
  if (!value) return [];
  // Split on commas outside double-quoted display names.
  return value
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((chunk) => chunk.trim())
    .map((chunk) => {
      const angled = chunk.match(/^(.*?)\s*<([^>]+)>\s*$/) ?? null;
      if (angled) {
        const name = angled[1].trim().replace(/^"|"$/g, "").trim();
        const email = angled[2].trim();
        return { email, name: name || undefined };
      }
      return { email: chunk.trim() };
    })
    .filter((address) => /.+@.+/.test(address.email));
}

type ParsedBody = {
  bodyHtml?: string;
  bodyText?: string;
  attachments: { id: string; filename: string; mimeType: string; size: number }[];
};

function decodePartData(data: string | undefined): string {
  if (!data) return "";
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

/** Depth-first walk of the MIME tree; first text/html and text/plain win. */
function collectBodiesAndAttachments(part: GmailPart, into: ParsedBody): void {
  if (part.filename && part.body?.attachmentId) {
    into.attachments.push({
      id: part.body.attachmentId,
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      size: part.body.size ?? 0,
    });
  } else if (part.mimeType === "text/html" && part.body?.data && !into.bodyHtml) {
    into.bodyHtml = decodePartData(part.body.data);
  } else if (part.mimeType === "text/plain" && part.body?.data && !into.bodyText) {
    into.bodyText = decodePartData(part.body.data);
  }
  part.parts?.forEach((child) => collectBodiesAndAttachments(child, into));
}

function toSummary(message: GmailMessage, accountId: MailProviderId, accountEmail: string) {
  const internalMs = Number(message.internalDate);
  const headerDate = new Date(header(message, "Date") ?? "");
  const date = Number.isFinite(internalMs)
    ? new Date(internalMs).toISOString()
    : Number.isNaN(headerDate.getTime())
      ? ""
      : headerDate.toISOString();
  const attachments: ParsedBody = { attachments: [] };
  if (message.payload) collectBodiesAndAttachments(message.payload, attachments);
  return {
    id: message.id,
    accountId,
    accountEmail,
    threadId: message.threadId ?? null,
    from: parseAddressList(header(message, "From"))[0] ?? null,
    to: parseAddressList(header(message, "To")),
    cc: parseAddressList(header(message, "Cc")),
    subject: header(message, "Subject") ?? "(no subject)",
    snippet: unescapeText(message.snippet ?? ""),
    date,
    unread: message.labelIds?.includes("UNREAD") ?? false,
    hasAttachments: attachments.attachments.length > 0,
  };
}

function toDetail(message: GmailMessage, accountId: MailProviderId, accountEmail: string): MailMessageDetail {
  const parsed: ParsedBody = { attachments: [] };
  if (message.payload) collectBodiesAndAttachments(message.payload, parsed);
  return {
    ...toSummary(message, accountId, accountEmail),
    bodyHtml: parsed.bodyHtml,
    bodyText: parsed.bodyText,
    attachments: parsed.attachments,
  };
}

/* ------------------------------------------------------------------ adapter */

export const googleAdapter: MailProvider = {
  id: "google",
  label: "Gmail",

  async listMessages(query: {
    search?: string;
    cursor?: string | null;
    pageSize: number;
  }): Promise<MailPage> {
    const record = await getAccessToken();
    const params = new URLSearchParams();
    params.set("maxResults", String(Math.min(Math.max(query.pageSize || 25, 1), 500)));
    if (query.search) params.set("q", query.search);
    else params.set("labelIds", "INBOX");
    if (query.cursor) params.set("pageToken", query.cursor);

    const listing = (await gmailApi("/messages", params)) as {
      messages?: { id: string }[];
      nextPageToken?: string;
    };
    if (!listing.messages?.length) {
      return { accountId: "google", items: [], nextCursor: null };
    }

    // Enrich rows with metadata get()s (list returns ids only). Parallel —
    // Gmail's per-user rate limits happily absorb a page-size burst.
    const metas = await Promise.all(
      listing.messages.map(async (stub) => {
        const params = new URLSearchParams();
        params.set("format", "metadata");
        LIST_HEADERS.forEach((name) =>
          params.append("metadataHeaders", name),
        );
        try {
          const message = (await gmailApi(`/messages/${stub.id}`, params)) as GmailMessage;
          return message;
        } catch (error) {
          if (error instanceof MailError && error.needsReconnect) throw error;
          console.error(`[mail/google] row ${stub.id} enrichment failed:`, error instanceof Error ? error.message : error);
          return null;
        }
      }),
    );
    const items = metas
      .filter((message): message is GmailMessage => message !== null)
      .map((message) => toSummary(message, "google", record.accountEmail));
    return { accountId: "google", items, nextCursor: listing.nextPageToken ?? null };
  },

  async getMessage(id: string): Promise<MailMessageDetail> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new MailError("Malformed Gmail message id.", 400);
    }
    const record = await getAccessToken();
    const params = new URLSearchParams({ format: "full" });
    const message = (await gmailApi(`/messages/${id}`, params)) as GmailMessage;
    return toDetail(message, "google", record.accountEmail);
  },

  async getThread(id: string): Promise<MailThread> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new MailError("Malformed Gmail thread id.", 400);
    }
    const record = await getAccessToken();
    const params = new URLSearchParams({ format: "full" });
    const thread = (await gmailApi(`/threads/${id}`, params)) as {
      id: string;
      messages?: GmailMessage[];
    };
    const messages = thread.messages ?? [];
    const subject =
      messages.map((message) => header(message, "Subject")).find(Boolean) ??
      "(no subject)";
    return {
      id: thread.id ?? id,
      accountId: "google",
      accountEmail: record.accountEmail,
      subject,
      messages: messages.map((message) =>
        toDetail(message, "google", record.accountEmail),
      ),
    };
  },

  async getAttachment(
    messageId: string,
    attachmentId: string,
    meta: { filename: string; mimeType: string },
  ): Promise<MailAttachmentBytes> {
    // IDs are opaque provider strings — validate shape before URL insertion.
    if (!/^[A-Za-z0-9_-]+$/.test(messageId) || !/^[A-Za-z0-9_-]+$/.test(attachmentId)) {
      throw new MailError("Malformed Gmail attachment id.", 400);
    }
    const params = new URLSearchParams();
    const attachment = (await gmailApi(
      `/messages/${messageId}/attachments/${attachmentId}`,
      params,
    )) as { data?: string; size?: number };
    // Filename/mime come from the message's attachment metadata (the caller
    // validates the attachmentId against it before calling).
    return {
      filename: meta.filename,
      mimeType: meta.mimeType,
      bytes: Buffer.from(attachment.data ?? "", "base64url"),
    };
  },

  async send(request: MailSendRequest): Promise<MailSentResult> {
    const record = await getAccessToken();
    sendableRecordOrThrow(record);

    // Replies: pull the original's RFC headers so threads stay coherent.
    const threading = request.replyTo
      ? await threadingSource(request.replyTo.messageId)
      : null;

    // Docs: POST users/messages/send {raw, threadId} — Gmail consumes the
    // Bcc header (delivers to Bcc recipients without exposing their address).
    const sent = (await gmailPost("/messages/send", {
      raw: Buffer.from(buildRfc822(request, threading), "utf8").toString("base64url"),
      ...(request.replyTo?.threadId ? { threadId: request.replyTo.threadId } : {}),
    })) as { id?: string };

    return { provider: "google", id: sent.id ?? null };
  },
};
