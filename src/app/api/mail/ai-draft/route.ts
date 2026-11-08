import { NextResponse, connection } from "next/server";
import { z } from "zod";
import { OpenCodeError } from "@/lib/journal/opencode";
import { draftMail } from "@/lib/mail/ai-draft";

/**
 * Draft-with-AI support for the compose drawer (Phase 7d). The owner's
 * explicit button click sends THIS untrusted boundary-respecting request to
 * the local OpenCode process — mail content never leaves the machine.
 * Inputs are zod-gated and truncated before they reach the model.
 */
const bodySchema = z.object({
  intent: z.enum(["reply", "new"]),
  from: z.string().max(320).optional(),
  subjectOfIncoming: z.string().max(998).optional(),
  quotedText: z.string().max(20_000).optional(),
  brief: z.string().max(4_000).default(""),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid AI-draft body." },
      { status: 400 },
    );
  }
  await connection();

  const { intent, from, subjectOfIncoming, quotedText, brief } = parsed.data;
  if (intent === "new" && !brief.trim()) {
    return NextResponse.json(
      { error: "Tell Secptile what the email should say (the brief is required for new mail)." },
      { status: 400 },
    );
  }
  if (intent === "reply" && !brief.trim() && !quotedText?.trim()) {
    return NextResponse.json(
      { error: "Nothing to work from — add a short brief of what the reply should say." },
      { status: 400 },
    );
  }

  try {
    const draft = await draftMail({ intent, from, subjectOfIncoming, quotedText, brief });
    return NextResponse.json({ draft });
  } catch (error) {
    const known = error instanceof OpenCodeError ? error : null;
    if (!known) console.error("[mail/ai-draft]", error);
    return NextResponse.json(
      { error: known?.message ?? "The AI draft could not be generated." },
      { status: known?.status ?? 502 },
    );
  }
}
