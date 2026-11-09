import { NextResponse } from "next/server";
import { z } from "zod";
import { daemonAuthorized, publishEffort, sameOrigin } from "@/lib/assistant";

/**
 * Sets how hard OpenCode thinks: the daemon's "mega evolve" and "kudos"
 * commands, or the mode button in the chat header.
 */

const effortBodySchema = z.object({
  effort: z.enum(["medium", "high"]),
});

export async function POST(request: Request) {
  if (!daemonAuthorized(request.headers) && !sameOrigin(request)) {
    return NextResponse.json({ error: "Not allowed to change the effort level." }, { status: 403 });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }
  const parsed = effortBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Effort must be 'medium' or 'high'." }, { status: 400 });
  }
  publishEffort(parsed.data.effort);
  return NextResponse.json({ ok: true, effort: parsed.data.effort });
}
