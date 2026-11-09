import { NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "@/lib/assistant";
import { OpenCodeError } from "@/lib/journal/opencode";
import { askModel } from "@/lib/secptile/ask-model";
import {
  SECTION_LABELS,
  SECTION_PATHS,
  classifyTurn,
  type Action,
} from "@/lib/secptile/classify";
import {
  checkMail,
  currentTime,
  feedbackSummary,
  historySummary,
  linkedinSummary,
  postsSummary,
  systemSummary,
  updatesSummary,
  type ToolReply,
} from "@/lib/secptile/tools";

/**
 * One turn of the Chat page, typed or spoken: works out what it's asking for
 * and answers it. A blog turn comes back as `journal`, and the page runs the
 * existing journal stream. Nothing here sends, publishes or changes anything.
 */

const MAX_TURN_CHARS = 20_000;

const turnBodySchema = z.object({
  text: z.string().trim().min(1).max(MAX_TURN_CHARS),
  mode: z.enum(["idle", "collecting", "session"]).default("idle"),
  chatSessionId: z.string().min(1).optional(),
});

type TurnResult =
  | { kind: "journal" }
  | { kind: "start_blog"; text: string; transcript?: string }
  | { kind: "cancel_blog"; text: string }
  | (ToolReply & { kind: "reply"; navigate?: boolean; chatSessionId?: string });

const LOOKUP_FAILED = "I couldn't get that just now. Please try again in a moment.";

async function lookUp(run: () => ToolReply | Promise<ToolReply>): Promise<ToolReply> {
  try {
    return await run();
  } catch (error) {
    console.error("[api/assistant/turn] lookup failed:", error);
    return { text: LOOKUP_FAILED };
  }
}

async function perform(action: Action): Promise<TurnResult> {
  switch (action.type) {
    case "journal":
      return { kind: "journal" };
    case "start_blog":
      return {
        kind: "start_blog",
        text: "Sure. Tell me about your day: what you did, what happened, and what you learned.",
        transcript: action.transcript,
      };
    case "cancel_blog":
      return { kind: "cancel_blog", text: "Okay, I've dropped that blog." };
    case "check_mail":
      return { kind: "reply", ...(await lookUp(checkMail)) };
    case "posts":
      return { kind: "reply", ...(await lookUp(postsSummary)) };
    case "feedback":
      return { kind: "reply", ...(await lookUp(feedbackSummary)) };
    case "history":
      return { kind: "reply", ...(await lookUp(historySummary)) };
    case "linkedin":
      return { kind: "reply", ...(await lookUp(linkedinSummary)) };
    case "updates":
      return { kind: "reply", ...(await lookUp(updatesSummary)) };
    case "system":
      return { kind: "reply", ...(await lookUp(systemSummary)) };
    case "time":
      return { kind: "reply", ...(await lookUp(currentTime)) };
    case "timer":
      return {
        kind: "reply",
        text: `Starting a ${action.minutes} minute timer. Stay on the Clock page to keep it running.`,
        href: `/clock?timer=${action.minutes}`,
        hrefLabel: "Open Clock",
        navigate: true,
      };
    case "open":
      return {
        kind: "reply",
        text: `Opening ${SECTION_LABELS[action.section]}.`,
        href: SECTION_PATHS[action.section],
        hrefLabel: `Open ${SECTION_LABELS[action.section]}`,
        navigate: action.section !== "chat",
      };
    case "needs_click":
      return {
        kind: "reply",
        text: action.message,
        href: SECTION_PATHS[action.section],
        hrefLabel: `Open ${SECTION_LABELS[action.section]}`,
        navigate: true,
      };
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Only the Secptile app can do this." }, { status: 403 });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }
  const parsed = turnBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid turn." },
      { status: 400 },
    );
  }
  const { text, mode, chatSessionId } = parsed.data;

  const action = classifyTurn(text, mode);
  if (action) return NextResponse.json(await perform(action));

  try {
    const { choice, sessionId } = await askModel(text, chatSessionId);
    const result: TurnResult =
      "answer" in choice ? { kind: "reply", text: choice.answer } : await perform(choice.action);
    return NextResponse.json(result.kind === "reply" ? { ...result, chatSessionId: sessionId } : result);
  } catch (error) {
    if (error instanceof OpenCodeError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[api/assistant/turn] failed:", error);
    return NextResponse.json({ error: "Something went wrong answering that." }, { status: 500 });
  }
}
