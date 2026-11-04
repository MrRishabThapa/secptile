import { NextResponse } from "next/server";
import { getPhoto } from "@/lib/blog-db";

type Context = { params: Promise<{ id: string }> };

/** Serve a stored cover photo's bytes to the owner's browser only. */
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const photo = getPhoto(id);
  if (!photo) {
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  }
  return new Response(new Uint8Array(photo.bytes), {
    headers: {
      "Content-Type": photo.mime,
      // Content-addressed by hash-stable ids; private because it's local-only.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
