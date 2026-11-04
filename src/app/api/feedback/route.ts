import { NextResponse } from "next/server";
import {
  actionSchema,
  approveComment,
  deleteComment,
  editCommentSchema,
  FeedbackError,
  feedbackConfigured,
  listPendingComments,
  saveCommentEdit,
} from "@/lib/feedback";

/** Pending comment queue: newest first, joined with the post for context. */
export async function GET() {
  if (!feedbackConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        pending: [],
        error:
          "Feedback is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
      },
      { status: 500 },
    );
  }
  try {
    return NextResponse.json({ configured: true, pending: await listPendingComments() });
  } catch (error) {
    if (error instanceof FeedbackError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[api/feedback] unexpected error:", error);
    return NextResponse.json(
      { error: "Unexpected server error while listing pending comments." },
      { status: 500 },
    );
  }
}

/** Decide a comment: approve (publish to the blog) or delete (remove). */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid action payload." },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.action === "approve") {
      await approveComment(parsed.data.id);
    } else {
      await deleteComment(parsed.data.id);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof FeedbackError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[api/feedback] unexpected error:", error);
    return NextResponse.json(
      { error: "Unexpected server error while deciding the comment." },
      { status: 500 },
    );
  }
}

/** Fix typos on a pending comment's name/message before approving. */
export async function PATCH(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }
  const parsed = editCommentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid edit payload." },
      { status: 400 },
    );
  }

  try {
    await saveCommentEdit(parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof FeedbackError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[api/feedback] unexpected error:", error);
    return NextResponse.json(
      { error: "Unexpected server error while saving the edit." },
      { status: 500 },
    );
  }
}
