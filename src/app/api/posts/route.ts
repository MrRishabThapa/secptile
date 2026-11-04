import { NextResponse } from "next/server";
import { listPosts } from "@/lib/blog-db";

/** Every post published through Secptile (blog + LinkedIn records). */
export async function GET() {
  try {
    return NextResponse.json({ posts: await listPosts() });
  } catch (error) {
    console.error("[api/posts] failed:", error);
    return NextResponse.json(
      { error: "Could not read posts." },
      { status: 500 },
    );
  }
}
