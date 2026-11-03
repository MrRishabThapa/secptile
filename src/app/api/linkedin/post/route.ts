import { NextResponse } from "next/server";
import { z } from "zod";
import { LinkedInError, postToLinkedIn } from "@/lib/linkedin";
import { updateStatus } from "@/lib/history";

const bodySchema = z.object({
  /** Plain LinkedIn text (markdown is NOT accepted on commentary). */
  text: z.string().min(1).max(3000),
  /**
   * The client must literally send `approved: true` — this posts to the
   * owner's real LinkedIn feed. Recorded confirmation (hard rule 1).
   */
  approved: z.literal(true),
  visibility: z.enum(["PUBLIC", "CONNECTIONS"]).default("PUBLIC"),
  /** Links the post to this day's history record, when known. */
  sessionId: z.string().min(1).optional(),
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
    const result = await postToLinkedIn(parsed.data.text, parsed.data.visibility);
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
