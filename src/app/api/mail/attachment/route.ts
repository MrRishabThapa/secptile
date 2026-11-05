import { NextResponse } from "next/server";
import { connection } from "next/server";
import { z } from "zod";
import { getMailProvider } from "@/lib/mail/provider";
import { MailError, type MailProviderId } from "@/lib/mail/types";

/** Attachment downloads: server-streamed, never proxied through the client. */
const querySchema = z.object({
  provider: z.enum(["google", "zoho"]),
  messageId: z.string().min(1).max(256),
  attachmentId: z.string().min(1).max(256),
});

/** Refuse before fetching anything rather than buffering a monster. */
const MAX_BYTES = 25 * 1024 * 1024;

/** RFC 6266 filename: strip control chars/quotes, encode as filename*=UTF-8. */
function contentDisposition(filename: string): string {
  const safe = filename.replace(/[\r\n\0"\\]/g, " ").trim() || "attachment";
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid attachment query." },
      { status: 400 },
    );
  }
  await connection();

  const { provider, messageId, attachmentId } = parsed.data;

  try {
    // Membership check FIRST (the provider interface's documented contract):
    // the adapter is only ever called with an attachment id that appears in
    // the message's own metadata — no guessing ids against the mail API.
    const adapter = getMailProvider(provider as MailProviderId);
    const detail = await adapter.getMessage(messageId);
    const meta = detail.attachments.find((attachment) => attachment.id === attachmentId);
    if (!meta) {
      return NextResponse.json(
        { error: "This attachment does not belong to that message." },
        { status: 404 },
      );
    }
    if (meta.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `Attachment exceeds the ${Math.round(MAX_BYTES / 1048576)} MB download limit.` },
        { status: 413 },
      );
    }

    const { bytes } = await adapter.getAttachment(messageId, attachmentId, {
      filename: meta.filename,
      mimeType: meta.mimeType,
    });

    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": meta.mimeType || "application/octet-stream",
        "content-length": String(bytes.length),
        "content-disposition": contentDisposition(meta.filename),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const mail = error instanceof MailError ? error : null;
    if (!mail) {
      // Unexpected shapes are logged server-side, never mirrored to clients.
      console.error("[mail/attachment]", error);
    }
    return NextResponse.json(
      {
        error:
          mail?.message ?? "The attachment could not be fetched.",
        needsReconnect: Boolean(mail?.needsReconnect),
      },
      { status: mail ? mail.status : 502 },
    );
  }
}
