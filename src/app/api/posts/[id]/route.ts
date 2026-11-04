import { NextResponse } from "next/server";
import { getPost } from "@/lib/blog-db";

type Context = { params: Promise<{ id: string }> };

/** One post published through Secptile — used by the tracker thread view. */
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  try {
    const post = getPost(id);
    if (!post) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }
    return NextResponse.json({ post });
  } catch (error) {
    console.error("[api/posts/[id]] failed:", error);
    return NextResponse.json(
      { error: "Could not read the post." },
      { status: 500 },
    );
  }
}
