import { NextResponse } from "next/server";
import { incrementViews } from "@/lib/blog-db";

type Context = { params: Promise<{ id: string }> };

/** Count one view of a post's thread/detail page. */
export async function POST(_request: Request, context: Context) {
  const { id } = await context.params;
  try {
    incrementViews(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/posts/view] failed:", error);
    return NextResponse.json(
      { error: "Could not record the view." },
      { status: 500 },
    );
  }
}
