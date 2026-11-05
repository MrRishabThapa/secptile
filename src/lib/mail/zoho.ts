/**
 * Zoho Mail adapter (Phase 7a) — official Zoho Mail REST API over plain
 * REST. Contracts verified against the current docs (Nov 2026):
 *
 * - OAuth (Server-based client, Zoho API Console):
 *     GET https://accounts.zoho.{dc}/oauth/v2/auth  (response_type=code,
 *     client_id, redirect_uri, scope — COMMA-separated ZohoMail…READ —
 *     access_type=offline for a refresh token, prompt=consent so reconnects
 *     re-mint one, state) → the callback carries code, location=<dc> and
 *     accounts-server=<accounts URL>; the grant code is valid 2 minutes.
 *     Token exchange/refresh: POST …/oauth/v2/token (params in the query
 *     string per the docs' sample) → access_token + refresh_token, 3600 s.
 * - Mail API base: https://mail.zoho.{dc}  (US .com, EU .eu, IN .in,
 *     AU .com.au, JP .jp, SA .sa, CA zohocloud.ca, CN .com.cn)
 * - Zoho-oauthtoken quirk: Mail APIs expect "Authorization:
 *     Zoho-oauthtoken <token>", NOT Bearer (explicitly documented).
 * - Read endpoints (all covered by the three READ scopes):
 *     GET /api/accounts                                        → accounts.READ
 *     GET /api/accounts/{id}/folders                           → folders.READ
 *     GET /api/accounts/{id}/messages/view                      → messages.READ
 *           ?folderId&start(1-based)&limit(≤200)                (offset paging)
 *     GET /api/accounts/{id}/messages/search?searchKey&start&limit&includeto
 *     GET /api/accounts/{id}/folders/{fid}/messages/{mid}/details → metadata
 *     GET /api/accounts/{id}/folders/{fid}/messages/{mid}/content → HTML body
 *     GET /api/accounts/{id}/folders/{fid}/messages/{mid}/attachments/{aid}
 * - Zoho has no thread resource: rows carry no threadId (Gmail-only view).
 *
 * Response field shapes vary across Zoho tenants/versions, so parsing is
 * deliberately tolerant. Errors are sanitized — tokens never surface.
 */
import "server-only";
import { mailEncryptionKeyValid } from "./crypto";
import { readMailToken, writeMailToken, type MailTokenRecord } from "./store";
import { unescapeText } from "./text";
import type {
  MailAddress,
  MailListQuery,
  MailMessageDetail,
  MailPage,
} from "./types";
import { MailError } from "./types";
import type { MailProvider, MailAttachmentBytes } from "./provider";

/* ------------------------------------------------------------------ config */

/** Read-only scopes, comma-separated (Zoho format). No write scopes. */
const ZOHO_SCOPES = [
  "ZohoMail.accounts.READ",
  "ZohoMail.folders.READ",
  "ZohoMail.messages.READ",
].join(",");

/** Access tokens live one hour — refresh with a wider margin than Gmail's. */
const REFRESH_MARGIN_MS = 5 * 60_000;

function normalizeDomain(value: string | undefined | null, fallback: string): string {
  return value?.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "") || fallback;
}

function config() {
  return {
    clientId: process.env.ZOHO_CLIENT_ID?.trim(),
    clientSecret: process.env.ZOHO_CLIENT_SECRET?.trim(),
    accountsDomain: normalizeDomain(process.env.ZOHO_ACCOUNTS_DOMAIN, "accounts.zoho.com"),
    mailDomain: normalizeDomain(process.env.ZOHO_MAIL_API_DOMAIN, "mail.zoho.com"),
    redirectUri:
      process.env.ZOHO_REDIRECT_URI?.trim() ||
      "http://localhost:3100/api/mail/zoho/callback",
    /** Optional: pin a mailbox when the account has more than one send-as. */
    mailboxHint: process.env.ZOHO_MAILBOX?.trim().toLowerCase() || "",
  };
}

export function zohoConfigured(): boolean {
  const { clientId, clientSecret } = config();
  return Boolean(clientId && clientSecret && mailEncryptionKeyValid());
}

/* -------------------------------------------------------------------- oauth */

export function authorizeUrl(state: string): string {
  const { clientId, redirectUri, accountsDomain } = config();
  if (!clientId) {
    throw new MailError("ZOHO_CLIENT_ID is not configured.", 500);
  }
  const url = new URL(`https://${accountsDomain}/oauth/v2/auth`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  // Comma-separated for Zoho (docs), encoded by URLSearchParams.
  url.searchParams.set("scope", ZOHO_SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function tokenRequest(
  params: Record<string, string>,
  failure: string,
): Promise<TokenResponse> {
  const { clientId, clientSecret, accountsDomain } = config();
  const url = new URL(`https://${accountsDomain}/oauth/v2/token`);
  // Docs' sample carries token params in the query string of the POST.
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set("client_id", clientId ?? "");
  url.searchParams.set("client_secret", clientSecret ?? "");

  const response = await fetch(url, { method: "POST" });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof json !== "object" || json === null) {
    throw new MailError(`${failure}: Zoho returned ${response.status}.`, 502);
  }
  const token = json as TokenResponse;
  if (!token.access_token) {
    const detail = token.error_description || token.error || "malformed response";
    throw new MailError(`${failure}: ${detail}.`, 502, token.error === "INVALID_CODE");
  }
  return token;
}

/**
 * Exchange the code → tokens → resolve the mailbox and Inbox folder →
 * persist everything encrypted. Zoho's grant code is single-use and valid
 * for 2 minutes — the callback calls this immediately.
 */
export async function zohoExchangeCode(code: string): Promise<string> {
  const { redirectUri, mailboxHint } = config();
  const token = await tokenRequest(
    { code, grant_type: "authorization_code", redirect_uri: redirectUri },
    "Zoho token exchange failed",
  );
  if (!token.refresh_token || !token.access_token) {
    throw new MailError(
      "Zoho did not return a usable token pair — run the connect flow again.",
      502,
      true,
    );
  }

  // One /api/accounts call resolves accountId AND mailbox email (matches
  // ZOHO_MAILBOX when several send-as identities exist on the account).
  const accounts = await connectApi(token.access_token, "/api/accounts");
  type AccountEntry = { id: string; email: string };
  const entries = arrayField(accounts, ["data", "accounts"]).map((entry: Record<string, unknown>) => ({
    id: pickField(entry, ["accountId", "accountIdLong", "id"]),
    email: mailboxEmailOf(entry),
  }));
  const byHint = entries.find((entry: AccountEntry) => entry.email.toLowerCase() === mailboxHint);
  const accountId = (byHint ?? entries[0])?.id ?? "";
  // Honest display constant when Zoho omits the send-as address (rare) —
  // the store treats an empty accountEmail as "not really connected".
  const accountEmail = (byHint ?? entries[0])?.email || "Zoho Mail";
  if (!accountId) {
    throw new MailError(
      "Zoho Mail returned no usable accounts (/api/accounts) — is mail on for this user?",
      502,
      true,
    );
  }

  const inboxFolderId = await resolveInboxFolder(token.access_token, accountId);
  await writeMailToken({
    provider: "zoho",
    accountEmail,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    scope: ZOHO_SCOPES,
    connectedAt: new Date().toISOString(),
    accountId,
    inboxFolderId: inboxFolderId ?? undefined,
  });
  return accountEmail;
}

/* -------------------------------------------------------------- raw plumbing */

type Json = unknown;

/** Tolerant field lookup: first key with a usable value. */
function pickField(source: unknown, keys: string[]): string {
  if (typeof source !== "object" || source === null) return "";
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

function arrayField(payload: Json, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (typeof payload === "object" && payload !== null) {
    const record = payload as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) return value as Record<string, unknown>[];
    }
  }
  return [];
}

/** Connect-time call: token passed in explicitly (no stored record yet). */
async function connectApi(accessToken: string, path: string, query?: URLSearchParams): Promise<Json> {
  const { mailDomain } = config();
  const url = new URL(`https://${mailDomain}${path}`);
  query?.forEach((value, key) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }, // docs quirk
  });
  if (!response.ok) {
    const detail = (await response.text()).split("\n")[0]?.trim().slice(0, 200);
    throw new MailError(
      `Zoho Mail request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      response.status === 429 ? 429 : 502,
    );
  }
  return (await response.json()) as Json;
}

/**
 * Mailbox email, doc-verified live (Nov 2026): org accounts carry
 * `emailAddress: [{ mailId, isPrimary, isAlias, … }]` — a nested identity
 * list, NOT a flat string. Prefer the primary confirmed identity, fall back
 * through the legacy flat keys for tenants that still send one.
 */
function mailboxEmailOf(entry: Record<string, unknown>): string {
  const identities = arrayField(entry, ["emailAddress"]);
  if (identities.length) {
    const primary = identities.find(
      (identity) =>
        pickField(identity, ["isPrimary"]) === "true" &&
        pickField(identity, ["isConfirmed"]) !== "false",
    );
    const chosen = primary ?? identities[0];
    const mailId = pickField(chosen, ["mailId", "email", "address"]);
    if (mailId) return mailId;
  }
  return pickField(entry, ["primaryEmailAddress", "mailboxAddress", "email", "fromAddress"]);
}

function resolveInboxFolder(accessToken: string, accountId: string): Promise<string | null> {
  return connectApi(
    accessToken,
    `/api/accounts/${encodeURIComponent(accountId)}/folders`,
  )
    .then((payload) => {
      const folder = arrayField(payload, ["data", "folders"]).find((candidate) =>
        pickField(candidate, ["folderName", "name"]).toLowerCase() === "inbox",
      );
      const id = pickField(folder ?? {}, ["folderId", "id"]);
      return id || null;
    })
    .catch((error) => {
      console.error("[mail/zoho] inbox folder resolution failed:", error instanceof Error ? error.message : error);
      return null; // listing may still work with a folderless fallback later
    });
}

/* --------------------------------------------------------- token lifecycle */

async function getAccessToken(options: { force?: boolean } = {}) {
  const record = await readMailToken("zoho");
  if (!record) {
    throw new MailError("Zoho Mail is not connected — run the OAuth flow first.", 400, true);
  }
  if (!options.force && Date.now() < record.expiresAt - REFRESH_MARGIN_MS) {
    return record;
  }
  if (!record.refreshToken) {
    throw new MailError(
      "Zoho access expired and no refresh token was stored — reconnect the account.",
      401,
      true,
    );
  }
  const token = await tokenRequest(
    { grant_type: "refresh_token", refresh_token: record.refreshToken },
    "Zoho token refresh failed",
  );
  if (!token.access_token) {
    throw new MailError("Zoho refresh did not yield an access token.", 502, true);
  }
  const refreshed: MailTokenRecord = {
    ...record,
    accessToken: token.access_token,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
  };
  await writeMailToken(refreshed);
  return refreshed;
}

/** Adapter call: identical Zoho-oauthtoken quirk, one 401 → refresh → retry. */
async function zohoGet(
  record: MailTokenRecord,
  path: string,
  query: URLSearchParams,
  retry = true,
): Promise<Json> {
  const { mailDomain } = config();
  const url = new URL(`https://${mailDomain}${path}`);
  query.forEach((value, key) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${record.accessToken}` },
  });
  if (response.status === 401 && retry && record.refreshToken) {
    const refreshed = await getAccessToken({ force: true });
    return zohoGet(refreshed, path, query, false);
  }
  if (!response.ok) {
    const detail = (await response.text()).split("\n")[0]?.trim().slice(0, 200);
    throw new MailError(
      `Zoho Mail request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      response.status === 429 ? 429 : 502,
    );
  }
  return (await response.json()) as Json;
}

/* ------------------------------------------------------------- normalization */

/** Zoho addresses arrive as strings ("Name <a@b>") or objects — handle both. */
function normalizeAddress(value: unknown): MailAddress | null {
  if (typeof value === "string") {
    const text = unescapeText(value.trim());
    const angled = text.match(/^(.*?)\s*<([^>]+)>\s*$/);
    if (angled) {
      const name = angled[1].trim().replace(/^"|"$/g, "").trim();
      return { email: angled[2].trim(), name: name || undefined };
    }
    return /.+@.+/.test(text) ? { email: text } : null;
  }
  // (objects unchanged)
  if (typeof value === "object" && value !== null) {
    const email = pickField(value, ["address", "email", "emailId"]);
    const name = pickField(value, ["name", "displayName", "senderName"]);
    if (/.+@.+/.test(email)) return { email, name: name || undefined };
  }
  return null;
}

function addressList(value: unknown): MailAddress[] {
  if (typeof value === "string") {
    // Zoho joins whole recipient lists into one escaped string with commas.
    return value
      .split(",")
      .map((chunk) => normalizeAddress(chunk))
      .filter((a): a is MailAddress => a !== null);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeAddress).filter((a): a is MailAddress => a !== null);
  }
  const single = normalizeAddress(value);
  return single ? [single] : [];
}

/** Opaque row ids are `folderId:messageId` — the content APIs need both. */
function splitMessageId(id: string): { folderId: string; messageId: string } | null {
  const match = id.match(/^(\d+):(\d+)$/);
  return match ? { folderId: match[1], messageId: match[2] } : null;
}

/** Zoho wraps most single-resource answers in { status, data: {...} }. */
function dataOf(payload: Json): ZohoListItem {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (typeof record.data === "object" && record.data !== null && !Array.isArray(record.data)) {
      return record.data as ZohoListItem;
    }
  }
  return (payload ?? {}) as ZohoListItem;
}

/** First present-and-object-valued key (e.g. attachmentInfo objects). */
function pickObj(source: ZohoListItem, keys: string[]): ZohoListItem | null {
  for (const key of keys) {
    const value = source[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as ZohoListItem;
    }
  }
  return null;
}

function zohoDate(value: unknown): string {
  const ms = Number(value);
  if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

type ZohoListItem = Record<string, unknown>;

function attachmentsOf(source: unknown): import("./types").MailAttachment[] {
  return arrayField(source, [
    "messageAttachments",
    "attachments",
    "data",
  ])
    .map((entry) => {
      const id = pickField(entry, ["id", "attachmentId"]);
      if (!id) return null;
      return {
        id,
        filename: pickField(entry, ["name", "filename", "description"]) || "attachment",
        mimeType: pickField(entry, ["mimeType", "contentType"]) || "application/octet-stream",
        size: Number(pickField(entry, ["size", "fileSize"]) || 0),
      };
    })
    .filter((a): a is import("./types").MailAttachment => a !== null);
}

/* ------------------------------------------------------------------ adapter */

export const zohoAdapter: MailProvider = {
  id: "zoho",
  label: "Zoho",

  async listMessages(query: MailListQuery): Promise<MailPage> {
    const record = await readMailToken("zoho");
    if (!record?.accountId) {
      throw new MailError("Zoho Mail is not connected — run the OAuth flow first.", 400, true);
    }
    const pageSize = Math.min(Math.max(query.pageSize || 25, 1), 200);
    const start = Math.max(1, Number.parseInt(query.cursor ?? "1", 10) || 1);
    const params = new URLSearchParams();
    params.set("start", String(start));
    params.set("limit", String(pageSize));

    const path = query.search
      ? `/api/accounts/${encodeURIComponent(record.accountId)}/messages/search`
      : `/api/accounts/${encodeURIComponent(record.accountId)}/messages/view`;
    if (query.search) {
      // Keep the Zoho column comparable with Gmail's INBOX listing unless
      // the search explicitly targets another folder (docs search syntax).
      params.set(
        "searchKey",
        /(^|\s)in:\s*[\w@.-]+/i.test(query.search)
          ? query.search
          : `in:inbox ${query.search}`,
      );
      params.set("includeto", "true");
    } else {
      if (!record.inboxFolderId) {
        // Resolve at connect time; a miss here is an honest error, not a guess.
        throw new MailError(
          "Zoho Inbox folder could not be resolved — reconnect the account.",
          502,
          true,
        );
      }
      params.set("folderId", record.inboxFolderId);
    }

    const payload = await zohoGet(record, path, params);
    const rows = arrayField(payload, ["data"]);
    const items = rows
      .filter((row) => pickField(row, ["id", "messageId"]))
      .map((row) => toSummary(row, record.accountEmail, record.inboxFolderId ?? ""));
    // Offset pagination: keep going only while pages come back full.
    const nextCursor = rows.length >= pageSize ? String(start + rows.length) : null;
    return { accountId: "zoho", items, nextCursor };
  },

  async getMessage(id: string): Promise<MailMessageDetail> {
    const record = await readMailToken("zoho");
    const ids = id ? splitMessageId(id) : null;
    if (!record?.accountId || !ids) {
      throw new MailError("Malformed Zoho message id.", 400);
    }
    const base = `/api/accounts/${encodeURIComponent(record.accountId)}/folders/${ids.folderId}/messages/${ids.messageId}`;

    // Doc-verified live shapes (Nov 2026): details/content answers arrive as
    // { status: …, data: { …fields } } — unwrap data; dates are sentDateInGMT
    // (ms as a string); absent cc reads literally "Not Provided" (address
    // parsing rejects it — no "@" — so the header stays empty, honest).
    const details = dataOf(await zohoGet(record, `${base}/details`, new URLSearchParams()));
    const content = dataOf(await zohoGet(record, `${base}/content`, new URLSearchParams()));
    const attachments = attachmentsOf(pickObj(details, ["attachmentInfo", "attachmentinfo"]) ?? details);

    return {
      id,
      accountId: "zoho",
      accountEmail: record.accountEmail,
      threadId: null,
      from: normalizeAddress(details.fromAddress ?? details.from ?? details.sender),
      to: addressList(details.to ?? details.toAddress),
      cc: addressList(details.cc ?? details.ccAddress),
      subject: pickField(details, ["subject"]) || "(no subject)",
      snippet: pickField(details, ["summary", "excerpt"]),
      date: zohoDate(details.sentDateInGMT ?? details.receivedTime),
      unread: false,
      hasAttachments: attachments.length > 0,
      // content.content is proper HTML (entities are real markup) — the
      // ADDRESS strings are the escaped ones, handled in normalizeAddress.
      bodyHtml: typeof content.content === "string" ? content.content : undefined,
      bodyText: typeof content.body === "string" ? content.body : undefined,
      attachments,
    };
  },

  async getAttachment(
    messageId: string,
    attachmentId: string,
    meta: { filename: string; mimeType: string },
  ): Promise<MailAttachmentBytes> {
    const record = await readMailToken("zoho");
    const ids = messageId ? splitMessageId(messageId) : null;
    if (!record?.accountId || !ids || !/^[A-Za-z0-9_-]+$/.test(attachmentId)) {
      throw new MailError("Malformed Zoho attachment id.", 400);
    }
    const { mailDomain } = config();
    const url = `https://${mailDomain}/api/accounts/${encodeURIComponent(record.accountId)}/folders/${ids.folderId}/messages/${ids.messageId}/attachments/${encodeURIComponent(attachmentId)}`;

    const fetchOnce = async (accessToken: string) =>
      fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
    let response = await fetchOnce(record.accessToken);
    if (response.status === 401 && record.refreshToken) {
      const refreshed = await getAccessToken({ force: true });
      response = await fetchOnce(refreshed.accessToken);
    }
    if (!response.ok) {
      throw new MailError(`Zoho attachment fetch failed (${response.status}).`, 502);
    }
    return { ...meta, bytes: Buffer.from(await response.arrayBuffer()) };
  },
};

function toSummary(
  row: ZohoListItem,
  accountEmail: string,
  fallbackFolderId: string,
): import("./types").MailMessageSummary {
  const messageId = pickField(row, ["id", "messageId"]);
  const folderId = pickField(row, ["fid", "folderId"]) || fallbackFolderId;
  const status = pickField(row, ["status"]).toLowerCase();
  return {
    id: `${folderId}:${messageId}`,
    accountId: "zoho",
    accountEmail,
    threadId: null,
    from: normalizeAddress(row.from ?? row.fromAddress),
    to: addressList(row.to ?? row.toAddress),
    cc: addressList(row.cc ?? row.ccAddress),
    subject: pickField(row, ["subject"]) || "(no subject)",
    snippet: unescapeText(pickField(row, ["summary", "excerpt", "preview"])),
    date: zohoDate(row.receivedTime),
    unread: status.startsWith("un"),
    hasAttachments:
      row.hasAttachment === true ||
      Number(row.attachmentCount ?? 0) > 0 ||
      row.hasAttachments === true,
  };
}
