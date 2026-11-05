import { NextResponse } from "next/server";
import { connection } from "next/server";
import { z } from "zod";
import { getMailProvider } from "@/lib/mail/provider";
import { MailError, type MailProviderId } from "@/lib/mail/types";

/**
 * One full message for the reading pane (Phase 7b): headers, bodies and
 * attachment metadata. Bodies go out RAW in JSON — sanitization is the
 * client's rendering contract (DOMPurify + sandboxed iframe), never cached,
 * never logged. Providers keep ids opaque; the row id round-trips untouched.
 */
const querySchema = z.object({
  provider: z.enum(["google", "zoho"]),
  id: z.string().min(1).max(256),
});

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid message query." },
      { status: 400 },
    );
  }
  await connection();

  const { provider, id } = parsed.data;
  try {
    const detail = await getMailProvider(provider as MailProviderId).getMessage(id);
    return NextResponse.json({ message: detail });
  } catch (error) {
    const mail = error instanceof MailError ? error : null;
    const status = mail?.status ?? 500;
    if (!mail) {
      // Unexpected shapes are logged server-side, never mirrored to clients.
      console.error("[mail/message]", error);
    }
    return NextResponse.json(
      {
        error: mail?.message ?? "The message could not be fetched.",
        needsReconnect: Boolean(mail?.needsReconnect),
      },
      { status: status >= 500 && !mail ? 502 : status },
    );
  }
}
