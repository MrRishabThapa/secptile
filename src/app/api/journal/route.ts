import { NextResponse } from "next/server";
import { OpenCodeError, runJournalPhase } from "@/lib/journal/opencode";
import { journalBodySchema } from "@/lib/journal/journal-request";
import { upsertDraftSession } from "@/lib/journal/history";

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const parsed = journalBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 },
    );
  }

  try {
    const { sessionId, phase } = await runJournalPhase(parsed.data);
    // History of past days (Phase 6): best-effort, never breaks the loop.
    if (phase.status === "ready" && sessionId && phase.draft) {
      try {
        await upsertDraftSession(sessionId, {
          title: phase.draft.title,
          body: phase.draft.body,
          tags: phase.draft.tags,
          linkedin: phase.draft.linkedin,
          transcript: parsed.data.transcript ?? undefined,
        });
      } catch (historyError) {
        console.error("[api/journal] history write failed:", historyError);
      }
    }
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
