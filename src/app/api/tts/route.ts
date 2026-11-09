import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Voice output (Qwen3-TTS-Flash via Alibaba DashScope): Secptile speaks its
 * responses instead of only printing them. The route takes the plain text to
 * say, asks DashScope for speech, and streams the WAV bytes straight back to
 * the browser — audio never touches the DOM/server-side storage.
 *
 * API shape verified against:
 * https://www.alibabacloud.com/help/en/model-studio/qwen-tts-api
 */

const DEFAULT_BASE_URL =
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

/** Qwen3-TTS input cap (per request, characters) — enforced before calling. */
const MAX_CHARS = 600;
const TIMEOUT = 60_000;

const bodySchema = z.object({
  text: z.string().trim().min(1).max(MAX_CHARS),
});

/** Only the fields we consume; DashScope may return more. */
const dashResponseSchema = z.object({
  output: z.object({
    audio: z.object({
      url: z.url(),
    }),
  }),
});

export async function POST(request: Request) {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "DASHSCOPE_API_KEY is not set. Add it to .env.local (Alibaba Model Studio)." },
      { status: 500 },
    );
  }

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

  const baseUrl = process.env.DASHSCOPE_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const model = process.env.TTS_MODEL?.trim() || "qwen3-tts-flash";
  const voice = process.env.TTS_VOICE?.trim() || "Cherry";
  const language = process.env.TTS_LANGUAGE?.trim() || "Auto";

  try {
    const synthesized = await fetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: { text: parsed.data.text, voice, language_type: language },
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!synthesized.ok) {
      const detail = await synthesized.text().catch(() => "");
      return NextResponse.json(
        { error: `Speech synthesis error (${synthesized.status}).${detail ? ` ${detail.slice(0, 200)}` : ""}` },
        { status: 502 },
      );
    }

    const parsedDash = dashResponseSchema.safeParse(await synthesized.json());
    if (!parsedDash.success) {
      return NextResponse.json({ error: "Speech service returned unexpected data." }, { status: 502 });
    }

    // The URL is a signed OSS link (24 h). Serve it through this app so the
    // browser never needs cross-origin access to Alibaba's bucket.
    const wav = await fetch(parsedDash.data.output.audio.url);
    if (!wav.ok) {
      return NextResponse.json({ error: `Audio download failed (${wav.status}).` }, { status: 502 });
    }
    return new Response(wav.body, {
      headers: {
        "Content-Type": wav.headers.get("content-type") ?? "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("TimeoutError") || message.includes("timed out")) {
      return NextResponse.json({ error: "Speech synthesis timed out." }, { status: 504 });
    }
    return NextResponse.json(
      { error: `Speech service not reachable: ${message.slice(0, 200)}` },
      { status: 502 },
    );
  }
}
