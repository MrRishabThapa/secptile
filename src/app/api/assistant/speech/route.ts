import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  clearSpeech,
  daemonOnline,
  publishSpeech,
  sameOrigin,
} from "@/lib/assistant";

/**
 * Chat page -> desktop daemon: "say this out loud". When the daemon is offline
 * the reply is `routed: false` and the browser speaks instead. The daemon
 * collects the text from GET /api/assistant/status.
 */

const speechBodySchema = z.object({
  text: z.string().trim().min(1).max(4000),
  expectReply: z.boolean().default(false),
});

const forbidden = () =>
  NextResponse.json({ error: "Only the Secptile app can do this." }, { status: 403 });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }
  const parsed = speechBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid speech payload." },
      { status: 400 },
    );
  }
  if (!daemonOnline()) return NextResponse.json({ routed: false });

  const id = randomUUID();
  publishSpeech({ ...parsed.data, id, at: new Date().toISOString() });
  return NextResponse.json({ routed: true, id });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing speech id." }, { status: 400 });
  clearSpeech(id);
  return NextResponse.json({ ok: true });
}
