import { NextResponse } from "next/server";
import { z } from "zod";
import { OpenCodeError, runJournalPhase } from "@/lib/opencode";

export const bodySchema = z
  .object({
    /** OpenCode session from a previous turn (same journal loop). */
    sessionId: z.string().min(1).optional(),
    /** Day summary transcript — first turn. */
    transcript: z.string().min(1).max(20_000).optional(),
    /** Private notes — context only, never published. */
    privateNotes: z.string().max(20_000).optional(),
    /** Answers to the previous questions, in the same order. */
    answers: z.array(z.string().min(1)).min(1).max(10).optional(),
  })
  .refine((b) => (b.transcript?.length ?? 0) > 0 || (b.answers?.length ?? 0) > 0, {
    message: "Provide either a transcript or answers to continue the loop.",
  });

export type JournalRequestBody = z.infer<typeof bodySchema>;

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 },
    );
  }

  try {
    const { sessionId, phase } = await runJournalPhase(parsed.data);
    return NextResponse.json({ sessionId, ...phase });
  } catch (error) {
    if (error instanceof OpenCodeError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[api/journal] unexpected error:", error);
    return NextResponse.json(
      { error: "Unexpected server error. Check the server logs." },
      { status: 500 },
    );
  }
}
