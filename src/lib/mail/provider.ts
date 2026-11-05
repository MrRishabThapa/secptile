/**
 * Provider-adapter interface (Phase 7a). One implementation per provider
 * (`google.ts`, `zoho.ts`); the API routes and UI never know which is which.
 * All methods are server-side only — adapters do not leak to the client.
 */
import "server-only";
import type {
  MailListQuery,
  MailMessageDetail,
  MailPage,
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

  /** Attachment bytes by opaque provider IDs; metadata comes from getMessage. */
  getAttachment(messageId: string, attachmentId: string): Promise<MailAttachmentBytes>;
}
