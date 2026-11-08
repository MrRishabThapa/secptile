import { NextResponse } from "next/server";
import { PENDING_UPDATES_SCHEMA, readPendingUpdates } from "@/lib/system/updates";

export const dynamic = "force-dynamic"; // Live pending list — never cache.

/**
 * GET /api/updates — the pending pacman/omarchy update list for the Updates
 * surface. Read-only (checkupdates copies the sync db), validated with zod
 * before it leaves the server.
 */
export async function GET() {
  try {
    const pending = PENDING_UPDATES_SCHEMA.parse(await readPendingUpdates());
    return NextResponse.json(pending);
  } catch (error) {
    console.error("[api/updates] failed:", error);
    return NextResponse.json(
      { error: "Could not read pending updates." },
      { status: 500 },
    );
  }
}
