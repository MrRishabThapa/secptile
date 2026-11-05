import { NextResponse } from "next/server";
import { connection } from "next/server";
import { z } from "zod";
import { getMailProvider } from "@/lib/mail/provider";
import { MailError, type MailProviderId } from "@/lib/mail/types";

/**
 * Gmail thread view (Phase 7b) — the conversation for messages whose row
 * carried a threadId. Zoho has no thread resource; its rows never set one,
 * so the client never calls here for zoho (and the adapter-less provider
 * answers honestly instead of pretending).
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
      { error: parsed.error.issues[0]?.message ?? "Invalid thread query." },
      { status: 400 },
    );
  }
  await connection();

  const provider = getMailProvider(parsed.data.provider as MailProviderId);
  if (!provider.getThread) {
    return NextResponse.json(
      { error: `${provider.label} has no thread view — messages open individually.` },
      { status: 501 },
    );
  }

  try {
    const thread = await provider.getThread(parsed.data.id);
    return NextResponse.json({ thread });
  } catch (error) {
    const mail = error instanceof MailError ? error : null;
    const status = mail?.status ?? 500;
    if (!mail) {
      console.error("[mail/thread]", error);
    }
    return NextResponse.json(
      {
        error: mail?.message ?? "The conversation could not be fetched.",
        needsReconnect: Boolean(mail?.needsReconnect),
      },
      { status: status >= 500 && !mail ? 502 : status },
    );
  }
}
