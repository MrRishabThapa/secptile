import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Voice output: Secptile speaks its responses through Piper, running on this
 * machine (secptile-tts.service). The route takes the text to say and returns
 * a WAV file. Text and audio never leave the machine.
 *
 * API shape verified against:
 * https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_HTTP.md
 */

const DEFAULT_PIPER_URL = "http://127.0.0.1:8082";
const MAX_CHARS = 4000;
const TIMEOUT = 60_000;

const bodySchema = z.object({
  text: z.string().trim().min(1).max(MAX_CHARS),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a 'text' field." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Secptile speaks at most ${MAX_CHARS} characters at a time.` },
      { status: 400 },
    );
  }

  const baseUrl = process.env.PIPER_URL?.trim() || DEFAULT_PIPER_URL;

  try {
    const synthesized = await fetch(`${baseUrl}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: parsed.data.text }),
      // A closed client request also stops the wait, so interrupting is instant.
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT)]),
    });
    if (!synthesized.ok) {
      const detail = await synthesized.text().catch(() => "");
      return NextResponse.json(
        { error: `Speech synthesis error (${synthesized.status}).${detail ? ` ${detail.slice(0, 200)}` : ""}` },
        { status: 502 },
      );
    }

    // Piper labels its WAV bytes as text/html, so the type is set here.
    return new Response(synthesized.body, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json({ error: "Speech synthesis timed out." }, { status: 504 });
    }
    return NextResponse.json(
      { error: `Piper not reachable at ${baseUrl}. Run: systemctl --user start secptile-tts` },
      { status: 503 },
    );
  }
}
