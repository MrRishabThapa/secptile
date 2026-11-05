import { NextResponse, connection } from "next/server";
import { z } from "zod";
import { getMailProvider } from "@/lib/mail/provider";
import { logSentMail } from "@/lib/mail/sent-log";
import { MailError, type MailProviderId } from "@/lib/mail/types";

/**
 * The one write route of Phase 7d: send new mail or a reply. The owner's
 * explicit Send click is the approval gate — the route itself only:
 *   1. zod-validates the composition,
 *   2. delegates to the provider adapter (scope-gated server-side),
 *   3. appends metadata-only record to the local sent log.
 * No predictable-sending, no queueing: failures surface honestly.
 */
const addressSchema = z.object({
  name: z.string().max(256).optional(),
  email: z.string().trim().toLowerCase().max(320).email(),
});

const bodySchema = z.object({
  provider: z.enum(["google", "zoho"]),
  to: z.array(addressSchema).min(1).max(50),
  cc: z.array(addressSchema).max(50).default([]),
  bcc: z.array(addressSchema).max(50).default([]),
  subject: z.string().max(998).default(""),
  bodyText: z.string().min(1).max(100_000),
  replyTo: z
    .object({
      messageId: z.string().min(1).max(256),
      threadId: z.string().max(256).nullable().default(null),
    })
    .nullable()
    .default(null),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid send body." },
      { status: 400 },
    );
  }
  await connection();

  const { provider, to, cc, bcc, subject, bodyText, replyTo } = parsed.data;
  try {
    const adapter = getMailProvider(provider as MailProviderId);
    if (!adapter.send) {
      throw new MailError("This provider cannot send mail.", 501);
    }
    // The adapter validates id shapes and scopes; the route stays thin.
    const sent = await adapter.send({
      to,
      cc,
      bcc,
      subject,
      bodyText,
      replyTo,
    });

    // Metadata-only: never the body.
    await logSentMail({
      ts: new Date().toISOString(),
      provider,
      to: to.map((address) => address.email),
      cc: cc.map((address) => address.email),
      subject,
      reply: Boolean(replyTo),
      providerMessageId: sent.id,
    }).catch((error) => {
      // A send that landed but failed to log is still a success — note it.
      console.error("[mail/send] sent-log append failed:", error);
    });

    return NextResponse.json({ sent });
  } catch (error) {
    const mail = error instanceof MailError ? error : null;
    const status = mail?.status ?? 500;
    if (!mail) console.error("[mail/send]", error);
    return NextResponse.json(
      {
        error: mail?.message ?? "The message could not be sent.",
        needsReconnect: Boolean(mail?.needsReconnect),
      },
      { status: status >= 500 && !mail ? 502 : status },
    );
  }
}
