import { NextResponse } from "next/server";
import { z } from "zod";

const MAX_AUDIO_BYTES = 50 * 1024 * 1024; // 50 MB — spoken journals, be generous
const TIMESTAMP = 300_000; // 5 min. CPU transcription can take a while

/** Body of whisper.cpp's /inference JSON response. */
const whisperResponseSchema = z.object({
  text: z.string(),
});

export async function POST(request: Request) {
  const baseUrl = process.env.WHISPER_API_URL?.trim() || "http://localhost:8080";

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data with a 'file' field." }, { status: 400 });
  }

  const file = incoming.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing audio file ('file' field)." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Recorded clip is empty — try again." }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Recording is too large (>50 MB)." }, { status: 413 });
  }

  // Fresh form: whisper.cpp expects the clip under "file"; keep the original
  // content type (browser sends webm/opus).
  const outgoing = new FormData();
  outgoing.append("file", new File([file], "clip.webm", { type: file.type || "audio/webm" }));
  outgoing.append("response_format", "json");

  try {
    const response = await fetch(`${baseUrl}/inference`, {
      method: "POST",
      body: outgoing,
      signal: AbortSignal.timeout(TIMESTAMP),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return NextResponse.json(
        { error: `Transcription server error (${response.status}).${detail ? ` ${detail.slice(0, 200)}` : ""}` },
        { status: 502 },
      );
    }
    // Some whisper.cpp server builds return SSE lines ("data: {...}"); accept both.
    const raw = await response.text();
    const jsonText = raw.trim().startsWith("data:") ? raw.trim().slice(5).trim() : raw.trim();
    const parsed = whisperResponseSchema.safeParse(JSON.parse(jsonText));
    if (!parsed.success) {
      return NextResponse.json({ error: "Transcription server returned unexpected data." }, { status: 502 });
    }
    return NextResponse.json({ text: parsed.data.text.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("TimeoutError") || message.includes("timed out")) {
      return NextResponse.json(
        { error: "Transcription timed out. Is the clip too long?" },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: `Transcription server not reachable at ${baseUrl}. Run: systemctl --user start secptile-whisper` },
      { status: 503 },
    );
  }
}
