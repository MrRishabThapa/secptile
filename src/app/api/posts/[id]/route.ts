import { NextResponse } from "next/server";
import { deletePost, getPost } from "@/lib/blog-db";

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

/** Remove one post from the tracker. */
export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  try {
    deletePost(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/posts/[id]/DELETE] failed:", error);
    return NextResponse.json(
      { error: "Could not delete the post." },
      { status: 500 },
    );
  }
}
