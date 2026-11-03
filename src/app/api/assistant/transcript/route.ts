import { NextResponse } from "next/server";
import { z } from "zod";
import { daemonAuthorized, publishTranscript } from "@/lib/assistant";

const transcriptBodySchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(50_000), // aligns with the publish body limit
});

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
  const parsed = transcriptBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid transcript payload." },
      { status: 400 },
    );
  }
  // Slots into the UI as "the assistant said this" — the app's own wake-phrase
  // logic and the existing /api/journal flow take it from there. Publishing
  // NEVER happens here (hard rule 1 — approval stays a button click).
  publishTranscript({ ...parsed.data, at: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
