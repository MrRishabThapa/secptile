import { NextResponse } from "next/server";
import { z } from "zod";
import {
  daemonAuthorized,
  publishStatus,
  readPendingTranscript,
  readStatus,
} from "@/lib/assistant";

export const dynamic = "force-dynamic"; // live status, never cached

const statusBodySchema = z.object({
  id: z.string().min(1),
  state: z.string().min(1).max(64),
  detail: z.string().max(500).default(""),
});

export async function GET() {
  return NextResponse.json({
    status: readStatus(),
    pending: readPendingTranscript(),
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
