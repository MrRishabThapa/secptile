import { NextResponse } from "next/server";
import { connection } from "next/server";
import { z } from "zod";
import {
  daemonAuthorized,
  publishStatus,
  readEffort,
  readEffortSupported,
  readPendingTranscript,
  readSpeech,
  readStatus,
} from "@/lib/assistant";

// cacheComponents (this Next version) rejects the old `dynamic` segment
// export; `await connection()` is the documented way to opt out of prerender.

const statusBodySchema = z.object({
  id: z.string().min(1),
  state: z.string().min(1).max(64),
  detail: z.string().max(500).default(""),
});

export async function GET() {
  await connection();
  const speech = readSpeech();
  return NextResponse.json({
    status: readStatus(),
    pending: readPendingTranscript(),
    // The age lets a restarted daemon skip speech it should no longer say.
    speech: speech && { ...speech, ageMs: Date.now() - Date.parse(speech.at) },
    effort: readEffort(),
    effortSupported: readEffortSupported(),
  });
}

export async function POST(request: Request) {
  if (!daemonAuthorized(request.headers)) {
    return NextResponse.json(
      { error: "Assistant daemon secret missing or wrong." },
      { status: 401 },
    );
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }
  const parsed = statusBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid status payload." },
      { status: 400 },
    );
  }
  publishStatus({ ...parsed.data, at: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
