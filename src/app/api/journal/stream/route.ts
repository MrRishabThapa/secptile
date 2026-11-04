import { NextResponse } from "next/server";
import { OpenCodeError, runJournalPhase, type RunProgress } from "@/lib/opencode";
import { journalBodySchema } from "@/lib/journal-request";
import { upsertDraftSession } from "@/lib/history";

/**
 * Streaming variant of POST /api/journal: newline-delimited JSON —
 *   {"type":"progress","message":"…"} while OpenCode works,
 *   then exactly one final {"status": …} line (same body as the non-streaming
 *   route) or {"type":"error","error":"…"} instead. The old endpoint stays;
 *   this one just adds live feedback for the 6–20s turns.
 */
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

  const encoder = new TextEncoder();
  const body = parsed.data;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const progress = (event: RunProgress) => {
        if (event.type === "started") {
          send({ type: "progress", message: "Talking to OpenCode…" });
        } else {
          send({ type: "progress", message: "OpenCode session started", sessionId: event.sessionId });
        }
      };

      try {
        const { sessionId, phase } = await runJournalPhase(body, progress);
        if (phase.status === "ready" && phase.draft) {
          try {
            await upsertDraftSession(sessionId, {
              title: phase.draft.title,
              body: phase.draft.body,
              tags: phase.draft.tags,
              linkedin: phase.draft.linkedin,
              transcript: body.transcript ?? undefined,
            });
          } catch (historyError) {
            console.error("[api/journal/stream] history write failed:", historyError);
          }
        }
        send({ sessionId, ...phase });
      } catch (error) {
        if (error instanceof OpenCodeError) {
          send({ type: "error", error: error.message, status: error.status });
        } else {
          console.error("[api/journal/stream] unexpected error:", error);
          send({ type: "error", error: "Unexpected server error. Check the server logs.", status: 500 });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
