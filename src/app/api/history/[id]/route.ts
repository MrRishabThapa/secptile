import { NextResponse } from "next/server";
import { deleteHistoryEntry } from "@/lib/journal/history";

type Context = { params: Promise<{ id: string }> };

/** Remove one day's history record (double-click remove on Past days). */
export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  try {
    await deleteHistoryEntry(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/history/DELETE] failed:", error);
    return NextResponse.json(
      { error: "Could not delete the day's record." },
      { status: 500 },
    );
  }
}
