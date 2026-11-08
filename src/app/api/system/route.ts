import { NextResponse } from "next/server";
import { SYSTEM_STATS_SCHEMA, readSystemStats } from "@/lib/system/system-stats";

export const dynamic = "force-dynamic"; // Live host readings — never cache.

/**
 * GET /api/system — one live snapshot of the machine for the About surface
 * (CPU, GPU, RAM + top apps, battery, host info). Validates the payload with
 * zod before it leaves the server.
 */
export async function GET() {
  try {
    const stats = SYSTEM_STATS_SCHEMA.parse(await readSystemStats());
    return NextResponse.json(stats);
  } catch (error) {
    console.error("[api/system] failed:", error);
    return NextResponse.json(
      { error: "Could not read system stats." },
      { status: 500 },
    );
  }
}
