import { NextResponse } from "next/server";
import { z } from "zod";
import { LinkedInError, postToLinkedIn } from "@/lib/linkedin";
import { LINKEDIN_TEXT_LIMIT } from "@/lib/linkedin-text";
import { updateStatus } from "@/lib/history";

const bodySchema = z
  .object({
    /** Plain LinkedIn text (markdown is NOT accepted on commentary). */
    text: z.string().min(1).max(LINKEDIN_TEXT_LIMIT),
    /**
     * The client must literally send `approved: true` — this posts to the
     * owner's real LinkedIn feed. Recorded confirmation (hard rule 1).
     */
    approved: z.literal(true),
    visibility: z.enum(["PUBLIC", "CONNECTIONS"]).default("PUBLIC"),
    /** Links the post to this day's history record, when known. */
    sessionId: z.string().min(1).optional(),
    /**
     * Article link preview (docs: Post Schema — content.article). source and
     * title are required together; the summary stays optional (<4086 chars).
     */
    articleUrl: z.string().url().max(2048).optional(),
    articleTitle: z.string().min(1).max(400).optional(),
    articleDescription: z.string().max(4086).optional(),
  })
  .refine((data) => Boolean(data.articleUrl) === Boolean(data.articleTitle), {
    error: "articleTitle is required with articleUrl (and vice versa).",
    path: ["articleTitle"],
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
    const { articleUrl, articleTitle, articleDescription } = parsed.data;
    const result = await postToLinkedIn(
      parsed.data.text,
      parsed.data.visibility,
      articleUrl
        ? {
            url: articleUrl,
            title: articleTitle ?? "",
            ...(articleDescription ? { description: articleDescription } : {}),
          }
        : undefined,
    );
    // Best-effort history cross-reference (Phase 6).
    if (parsed.data.sessionId && result.postUrn) {
      try {
        await updateStatus(parsed.data.sessionId, { linkedInUrn: result.postUrn });
      } catch (historyError) {
        console.error("[api/linkedin/post] history update failed:", historyError);
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
