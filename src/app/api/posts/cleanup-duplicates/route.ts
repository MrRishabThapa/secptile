import { NextResponse } from "next/server";
import { deleteDuplicatePosts } from "@/lib/blog-db";

/** Remove duplicate posts, keeping the newest per journal session. */
export async function POST() {
  try {
    const result = deleteDuplicatePosts();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[api/posts/cleanup-duplicates] failed:", error);
    return NextResponse.json(
      { error: "Could not clean up duplicates." },
      { status: 500 },
    );
  }
}
