/**
 * Unified mail domain types (Phase 7) — the provider-agnostic shape the
 * adapters normalize to. This file is CLIENT-SAFE: it stays free of imports
 * from server-only modules (store/provider adapters import from here, never
 * the other way around).
 */

export const MAIL_PROVIDERS = ["google", "zoho"] as const;
export type MailProviderId = (typeof MAIL_PROVIDERS)[number];

export type MailAddress = {
  name?: string;
  email: string;
};

/** One inbox row: everything the unified list needs (no bodies). */
export type MailMessageSummary = {
  id: string;
  accountId: MailProviderId;
  /** Which mailbox the message belongs to (the connected account). */
  accountEmail: string;
  threadId: string | null;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  snippet: string;
  /** ISO timestamp (provider's receive time). */
  date: string;
  unread: boolean;
  hasAttachments: boolean;
};

/** A provider-paginated list result. `nextCursor` is provider-shaped. */
export type MailPage = {
  accountId: MailProviderId;
  items: MailMessageSummary[];
  nextCursor: string | null;
};

export type MailAttachment = {
  /** Provider attachment ID — opaque, round-tripped through the UI. */
  id: string;
  filename: string;
  mimeType: string;
  /** Bytes as reported by the provider. */
  size: number;
};

/** Full message for the message view (bodies included). */
export type MailMessageDetail = MailMessageSummary & {
  bodyHtml?: string;
  bodyText?: string;
  attachments: MailAttachment[];
};

/** Gmail conversation: ordered messages, newest last. */
export type MailThread = {
  id: string;
  accountId: MailProviderId;
  accountEmail: string;
  subject: string;
  messages: MailMessageDetail[];
};

export type MailListQuery = {
  search?: string;
  /** Opaque provider cursor (Gmail pageToken, Zoho start offset). */
  cursor?: string | null;
  pageSize: number;
};

/**
 * One outgoing mail — plain-text body in v1. Sent only on the owner's
 * explicit click (hard rule 1); adapters turn this into provider requests.
 */
export type MailSendRequest = {
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  bodyText: string;
  /**
   * Present for replies: the original message the adapter thread-frames the
   * send against (Gmail threadId + RFC headers, Zoho reply action).
   */
  replyTo?: { messageId: string; threadId: string | null } | null;
};

/** Adapter result of a successful send; `id` is provider-shaped or null. */
export type MailSentResult = {
  provider: MailProviderId;
  id: string | null;
};

/**
 * Mail errors carry a sanitized message (no token material ever) and, when
 * true, `needsReconnect` — the UI shows a Reconnect pill instead of a stack.
 */
export class MailError extends Error {
  readonly status: number;
  readonly needsReconnect: boolean;
  constructor(message: string, status = 500, needsReconnect = false) {
    super(message);
    this.name = "MailError";
    this.status = status;
    this.needsReconnect = needsReconnect;
  }
}
