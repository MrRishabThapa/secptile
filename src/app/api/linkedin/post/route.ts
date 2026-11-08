import { NextResponse } from "next/server";
import { z } from "zod";
import { LinkedInError, postToLinkedIn } from "@/lib/linkedin/linkedin";
import { LINKEDIN_TEXT_LIMIT } from "@/lib/linkedin/linkedin-text";
import { getPhoto, markLinkedInBySession } from "@/lib/blog-db";

const bodySchema = z
  .object({
    /** The approved hook-format LinkedIn text (plain, no markdown). */
    text: z.string().min(1).max(LINKEDIN_TEXT_LIMIT),
    /**
     * The client must literally send `approved: true` — this posts to the
     * owner's real LinkedIn feed. Recorded confirmation (hard rule 1).
     */
    approved: z.literal(true),
    visibility: z.enum(["PUBLIC", "CONNECTIONS"]).default("PUBLIC"),
    /** Optional: attach the post's cover photo as the image. */
    photoId: z.string().min(1).max(64).optional(),
    /** Alt text for the attached image — kept short (schema recommends <120). */
    imageAlt: z.string().min(1).max(120).optional(),
    /** Links the post to this day's history record, when known. */
    sessionId: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.photoId) || !data.imageAlt, {
    error: "imageAlt only makes sense with a photoId.",
    path: ["imageAlt"],
  });

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid post payload." },
      { status: 400 },
    );
  }

  try {
    let image: { bytes: Uint8Array; mime: string; altText: string } | undefined;
    if (parsed.data.photoId) {
      const photo = getPhoto(parsed.data.photoId);
      if (!photo) {
        return NextResponse.json(
          { error: "The cover photo vanished — re-attach it before posting." },
          { status: 400 },
        );
      }
      image = {
        bytes: photo.bytes,
        mime: photo.mime,
        altText: parsed.data.imageAlt ?? "Cover photo",
      };
    }

    const result = await postToLinkedIn(parsed.data.text, parsed.data.visibility, {
      image,
    });

    // Best-effort bookkeeping: history record AND the blog DB row.
    if (result.postUrn) {
      if (parsed.data.sessionId) {
        try {
          markLinkedInBySession(parsed.data.sessionId, result.postUrn);
        } catch (dbError) {
          console.error("[api/linkedin/post] blog DB update failed:", dbError);
        }
      }
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LinkedInError) {
      return NextResponse.json(
        { error: error.message, needsReauth: error.needsReauth },
        { status: error.status },
      );
    }
    console.error("[api/linkedin/post] unexpected error:", error);
    return NextResponse.json(
      { error: "Unexpected server error while posting to LinkedIn." },
      { status: 500 },
    );
  }
}
