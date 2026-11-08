import { NextResponse } from "next/server";
import { UPDATE_THREAD_SCHEMA, readUpdateThread } from "@/lib/system/updates";

export const dynamic = "force-dynamic"; // Reads live package state — never cache.

const NAME = /^[a-zA-Z0-9._-]+$/; // Pacman package names only.

/**
 * GET /api/updates/[name] — the detail thread for one pending update: repo,
 * description, dependencies, provides, install size and reason, read from
 * the local pacman databases only. 404 when the package is not pending.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!NAME.test(name)) {
    return NextResponse.json({ error: "Invalid package name." }, { status: 400 });
  }
  try {
    const thread = UPDATE_THREAD_SCHEMA.parse(await readUpdateThread(name, null));
    return NextResponse.json(thread);
  } catch (error) {
    if (error instanceof Error && error.name === "UpdateNotFound") {
      return NextResponse.json(
        { error: `No pending update for ${name}.` },
        { status: 404 },
      );
    }
    console.error("[api/updates/[name]] failed:", error);
    return NextResponse.json(
      { error: `Could not read the update thread for ${name}.` },
      { status: 500 },
    );
  }
}
