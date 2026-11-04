import { NextResponse } from "next/server";
import { BlogError, PHOTO_MIMES, PHOTO_MAX_BYTES, savePhoto } from "@/lib/blog-db";

/**
 * Cover-photo upload for today's post. The photo is mandatory before a post
 * can publish; it is stored inside the blog DB and served via /api/photos/[id].
 * Only JPEG/PNG/GIF — the same formats LinkedIn accepts, so the exact bytes
 * uploaded here can later be attached to the LinkedIn post unchanged.
 */
export async function POST(request: Request) {
  let formData: FormData | null = null;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Body must be a multipart form." }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Send the cover photo as a multipart 'file' field." },
      { status: 400 },
    );
  }
  if (!PHOTO_MIMES.includes(file.type)) {
    return NextResponse.json(
      { error: "The cover photo must be JPEG, PNG, or GIF (LinkedIn supported formats)." },
      { status: 415 },
    );
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return NextResponse.json(
      { error: "The cover photo is larger than 8 MB." },
      { status: 413 },
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = savePhoto(bytes, file.type);
    return NextResponse.json({ id, url: `/api/photos/${id}` });
  } catch (error) {
    if (error instanceof BlogError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[api/photos] unexpected error:", error);
    return NextResponse.json(
      { error: "Unexpected server error while storing the photo." },
      { status: 500 },
    );
  }
}
