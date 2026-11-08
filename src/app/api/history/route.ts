import { NextResponse } from "next/server";
import { listHistory } from "@/lib/journal/history";

export async function GET() {
  try {
    return NextResponse.json({ entries: await listHistory() });
  } catch (error) {
    console.error("[api/history] failed:", error);
    return NextResponse.json(
      { error: "Could not read history." },
      { status: 500 },
    );
  }
}
