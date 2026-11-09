/**
 * For turns the rules can't place: OpenCode either picks one of Secptile's
 * actions or answers. It only ever sees what you said, never your mail or other
 * app data, so it can't be misled by what someone wrote to you, and it has no
 * way to act except by choosing from this short list.
 */
import "server-only";
import { z } from "zod";
import { extractJson, runOpenCodeText } from "@/lib/journal/opencode";
import type { Action, Section } from "./classify";

const MODEL_TIMEOUT = 60_000;

const PROMPT = `You are Secptile, a voice assistant inside the owner's personal app. Reply with ONLY one JSON object, with no prose or code fences.

To look something up in the app, choose an action:
{"action":"check_mail"}  unread email
{"action":"posts"}  published posts and views
{"action":"feedback"}  blog comments waiting for review
{"action":"history"}  past journal days
{"action":"linkedin"}  LinkedIn connection
{"action":"updates"}  pending system updates
{"action":"system"}  CPU, memory, battery
{"action":"time"}  current time and date
{"action":"kartabya_messages"}  new team messages in Kartabya
{"action":"kartabya_mentions"}  mentions of the owner in Kartabya
{"action":"kartabya_tasks"}  the owner's Kartabya tasks
{"action":"kartabya_stats"}  the owner's Kartabya stats
{"action":"open","section":"chat|tea|clock|tracker|mail|feedback|updates|about"}  open a page
{"action":"start_blog"}  ONLY when the owner asks to write a blog or LinkedIn post

Otherwise answer yourself in one or two short spoken sentences, without markdown:
{"action":"answer","reply":"..."}

Rules:
- You cannot see the owner's mail, posts or files, so never claim to know what is in them. Choose an action.
- You cannot send, publish, approve or delete anything. Say that it needs the owner's click in the app.
- If the owner talks about their day without asking for a blog, reply warmly and mention they can say "write a blog".
- Do not use any tools.

The owner said:`;

const SECTIONS = ["chat", "tea", "clock", "tracker", "mail", "feedback", "updates", "about"] as const;

const replySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("answer"), reply: z.string().min(1).max(1200) }),
  z.object({ action: z.literal("open"), section: z.enum(SECTIONS) }),
  z.object({
    action: z.enum([
      "check_mail",
      "posts",
      "feedback",
      "history",
      "linkedin",
      "updates",
      "system",
      "time",
      "kartabya_messages",
      "kartabya_mentions",
      "kartabya_tasks",
      "kartabya_stats",
      "start_blog",
    ]),
  }),
]);

export type ModelChoice = { action: Action } | { answer: string };

export async function askModel(
  text: string,
  sessionId: string | undefined,
): Promise<{ choice: ModelChoice; sessionId: string | undefined }> {
  const result = await runOpenCodeText(`${PROMPT}\n${text}`, { sessionId, timeoutMs: MODEL_TIMEOUT });
  const parsed = replySchema.safeParse(extractJson(result.text));
  const nextSession = result.sessionId || sessionId;
  if (!parsed.success) {
    // A plain sentence is still a usable answer. Anything shaped like JSON isn't.
    const plain = result.text.trim();
    if (plain && !plain.includes("{")) return { choice: { answer: plain.slice(0, 1200) }, sessionId: nextSession };
    return {
      choice: { answer: "Sorry, I didn't get that. Could you say it another way?" },
      sessionId: nextSession,
    };
  }
  const data = parsed.data;
  if (data.action === "answer") return { choice: { answer: data.reply }, sessionId: nextSession };
  if (data.action === "open") {
    return { choice: { action: { type: "open", section: data.section as Section } }, sessionId: nextSession };
  }
  return { choice: { action: { type: data.action } }, sessionId: nextSession };
}
