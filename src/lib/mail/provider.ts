/**
 * Provider-adapter interface (Phase 7a). One implementation per provider
 * (`google.ts`, `zoho.ts`); the API routes and UI never know which is which.
 * All methods are server-side only — adapters do not leak to the client.
 */
import "server-only";
import { googleAdapter } from "./google";
import { zohoAdapter } from "./zoho";
import type {
  MailListQuery,
  MailMessageDetail,
  MailPage,
  MailSendRequest,
  MailSentResult,
  MailThread,
  MailProviderId,
} from "./types";

export type MailAttachmentBytes = {
  filename: string;
  mimeType: string;
  /** Raw attachment content, streamed through the server on click. */
  bytes: Buffer;
};

export interface MailProvider {
  readonly id: MailProviderId;
  /** Display name for the account switcher ("Gmail", "Zoho"). */
  readonly label: string;

  /**
   * Inbox page. `search` applies provider search when given; otherwise the
   * adapter lists the inbox-like default (Gmail INBOX label / Zoho inbox).
   */
  listMessages(query: MailListQuery): Promise<MailPage>;

  /** One full message: headers, parsed bodies and attachment metadata. */
  getMessage(id: string): Promise<MailMessageDetail>;

  /** Conversation view — Gmail only (Zoho has no thread resource). */
  getThread?(id: string): Promise<MailThread>;

  /**
   * Attachment bytes. `meta` carries the filename/mime from the message's
   * attachment metadata — the route validates the attachmentId belongs to
   * that message before calling, so adapters don't re-fetch metadata.
   */
  getAttachment(
    messageId: string,
    attachmentId: string,
    meta: { filename: string; mimeType: string },
  ): Promise<MailAttachmentBytes>;

  /**
   * Send new mail or a reply — only ever invoked from the send route after
   * the owner's explicit click. Adapters must fail with a reconnect-flagged
   * MailError when the stored token lacks the provider's send scope.
   */
  send?(request: MailSendRequest): Promise<MailSentResult>;
}

/** Validated-id registry for the API routes — never called with user strings. */
const ADAPTERS: Record<MailProviderId, MailProvider> = {
  google: googleAdapter,
  zoho: zohoAdapter,
};

export function getMailProvider(id: MailProviderId): MailProvider {
  return ADAPTERS[id];
}
