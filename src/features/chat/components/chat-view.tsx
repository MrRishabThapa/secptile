"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { z } from "zod";
import { AssistantBar } from "@/features/assistant/components/assistant-bar";
import { PastDays } from "@/features/days/components/past-days";
import { VoiceToggle } from "@/features/voice/components/voice-toggle";
import { callJournalStream, type ApiBody, type Draft } from "@/lib/journal/journal-client";
import { WAKE_GREETING, detectWakePhrase } from "@/lib/journal/wake";
import { sendAssistantTurn } from "@/lib/secptile/turn-client";
import { announceThroughDaemon, cancelSpeech, speak } from "@/lib/voice/speaker";
import { ChatComposer } from "./chat-composer";
import {
  AssistantAvatar,
  ChatMessage,
  ThinkingBubble,
  type ChatMessageData,
} from "./chat-message";

/** The thread, kept for this browser session so a trip to Today's Tea doesn't lose it. */
const CHAT_KEY = "secptile:chat";
/** Draft + session handed to Today's Tea for one navigation ("/tea" reads and clears it). */
const HANDOFF_KEY = "secptile:handoff";
/** Open questions left by a regeneration note on Today's Tea. Read once, then cleared. */
const RETURNED_QUESTIONS_KEY = "secptile:questions";

const QUESTIONS_INTRO = "A few questions to complete the story:";
const DRAFT_READY = "Your draft is ready in Today's Tea.";

const WELCOME =
  "What can I do for you? Ask about your mail, posts, comments or updates, open any section, or say \u201cwrite a blog\u201d to turn your day into a post.";

const savedChatSchema = z.object({
  sessionId: z.string().nullable(),
  collecting: z.boolean().default(false),
  chatSessionId: z.string().nullable().default(null),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["user", "assistant"]),
      text: z.string(),
      questions: z.array(z.string()).optional(),
      items: z.array(z.string()).optional(),
      href: z.string().optional(),
      hrefLabel: z.string().optional(),
      tone: z.enum(["error", "ready"]).optional(),
      spoken: z.boolean().optional(),
      hasPrivateNotes: z.boolean().optional(),
    }),
  ),
});

const returnedQuestionsSchema = z.object({
  sessionId: z.string(),
  questions: z.array(z.string()),
});

function readStored<T>(key: string, schema: z.ZodType<T>): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? schema.parse(JSON.parse(raw)) : null;
  } catch {
    return null; // private mode or a corrupt value: start clean
  }
}

function newMessage(fields: Omit<ChatMessageData, "id">): ChatMessageData {
  return { id: crypto.randomUUID(), ...fields };
}

function questionsMessage(questions: string[]): ChatMessageData {
  return newMessage({ role: "assistant", text: QUESTIONS_INTRO, questions });
}

function questionSpeech(questions: string[]): string {
  return `A few questions to complete the story. ${questions.join(" ")}`;
}

function loadChat(): {
  messages: ChatMessageData[];
  sessionId: string | null;
  collecting: boolean;
  chatSessionId: string | null;
  returnedQuestions: string[] | null;
} {
  const saved = readStored(CHAT_KEY, savedChatSchema);
  const returned = readStored(RETURNED_QUESTIONS_KEY, returnedQuestionsSchema);
  try {
    sessionStorage.removeItem(RETURNED_QUESTIONS_KEY);
  } catch {
    /* private mode */
  }
  if (returned && returned.questions.length > 0) {
    return {
      messages: [...(saved?.messages ?? []), questionsMessage(returned.questions)],
      sessionId: returned.sessionId,
      collecting: false,
      chatSessionId: saved?.chatSessionId ?? null,
      returnedQuestions: returned.questions,
    };
  }
  return {
    messages: saved?.messages ?? [],
    sessionId: saved?.sessionId ?? null,
    collecting: saved?.collecting ?? false,
    chatSessionId: saved?.chatSessionId ?? null,
    returnedQuestions: null,
  };
}

function stashHandoff(sessionId: string | null, draft: Draft) {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ sessionId, draft }));
  } catch {
    /* private mode — the day must be redone in that case */
  }
}

/**
 * The Chat page: Secptile's one conversation. Typed, browser-mic and
 * desktop-daemon turns all land here, and /api/assistant/turn decides what each
 * one wants. A blog runs only when you ask for one. Nothing in this view can
 * publish or send; those stay a button click on their own pages.
 */
export function ChatView() {
  const router = useRouter();
  const [initial] = useState(loadChat);
  const [messages, setMessages] = useState<ChatMessageData[]>(initial.messages);
  const [sessionId, setSessionId] = useState<string | null>(initial.sessionId);
  /** You asked for a blog, and your next turn is the day's story. */
  const [collecting, setCollecting] = useState(initial.collecting);
  /** OpenCode's memory of general questions, separate from any blog. */
  const [chatSessionId, setChatSessionId] = useState<string | null>(initial.chatSessionId);
  const [draftText, setDraftText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        CHAT_KEY,
        JSON.stringify({ messages, sessionId, collecting, chatSessionId }),
      );
    } catch {
      /* private mode — the thread lasts until the page closes */
    }
  }, [messages, sessionId, collecting, chatSessionId]);

  // Scrolls the thread only, so a new message never moves the page under you.
  useEffect(() => {
    const element = thread.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, busy, progress]);

  useEffect(() => {
    if (initial.returnedQuestions) {
      void speak(questionSpeech(initial.returnedQuestions), { expectReply: true });
    }
    return cancelSpeech;
  }, [initial]);

  function append(message: ChatMessageData) {
    setMessages((current) => [...current, message]);
  }

  function greet() {
    append(newMessage({ role: "assistant", text: WAKE_GREETING }));
    void speak(WAKE_GREETING, { expectReply: true });
  }

  function handlePhase(id: string, data: ApiBody) {
    if (data.status === "ready" && data.draft) {
      append(newMessage({ role: "assistant", text: DRAFT_READY, tone: "ready" }));
      setSessionId(null); // the next message starts a new journal
      stashHandoff(id, data.draft);
      announceThroughDaemon(DRAFT_READY);
      router.push("/tea");
      return;
    }
    setSessionId(id);
    append(questionsMessage(data.questions));
    void speak(questionSpeech(data.questions), { expectReply: true });
  }

  function say(text: string) {
    append(newMessage({ role: "assistant", text }));
    void speak(text, { expectReply: true });
  }

  async function runJournal(text: string, privateNotes: string | undefined) {
    const data = await callJournalStream(
      sessionId ? { sessionId, answers: [text] } : { transcript: text, privateNotes },
      setProgress,
    );
    setCollecting(false);
    handlePhase(data.sessionId, data);
  }

  async function sendTurn(text: string, options: { spoken?: boolean; privateNotes?: string } = {}) {
    cancelSpeech();
    const turn = newMessage({
      role: "user",
      text,
      spoken: options.spoken,
      hasPrivateNotes: Boolean(options.privateNotes),
    });
    append(turn);
    setBusy(true);
    try {
      const result = await sendAssistantTurn({
        text,
        mode: sessionId ? "session" : collecting ? "collecting" : "idle",
        chatSessionId: chatSessionId ?? undefined,
      });
      if (result.kind === "journal") {
        await runJournal(text, options.privateNotes);
      } else if (result.kind === "start_blog") {
        if (result.transcript) {
          await runJournal(result.transcript, options.privateNotes);
        } else {
          setCollecting(true);
          say(result.text);
        }
      } else if (result.kind === "cancel_blog") {
        setCollecting(false);
        setSessionId(null);
        say(result.text);
      } else {
        if (result.chatSessionId) setChatSessionId(result.chatSessionId);
        append(
          newMessage({
            role: "assistant",
            text: result.text,
            items: result.items,
            href: result.href,
            hrefLabel: result.hrefLabel,
          }),
        );
        if (result.navigate && result.href) {
          // Leaving this page cancels its speech, so the daemon takes this line.
          announceThroughDaemon(result.text);
          router.push(result.href);
        } else {
          void speak(result.text);
        }
      }
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "Something went wrong.";
      // Give the words back, so a long spoken day is never lost to a failed send.
      setMessages((current) => current.filter((message) => message.id !== turn.id));
      setDraftText((current) => current || text);
      append(newMessage({ role: "assistant", text: reason, tone: "error" }));
      void speak(`Something went wrong. ${reason}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  /** Browser mic: the wake command greets, and other words go in the box to edit. */
  function handleVoiceText(text: string) {
    const { woke, remainder } = detectWakePhrase(text);
    if (woke && !remainder) {
      greet();
      return;
    }
    const words = woke ? remainder : text;
    setDraftText((current) => (current.trim() ? `${current.trim()} ${words}` : words));
  }

  function submitDraft(privateNotes: string | undefined) {
    const { woke, remainder } = detectWakePhrase(draftText);
    const text = woke ? remainder : draftText.trim();
    setDraftText("");
    if (text) void sendTurn(text, { privateNotes });
    else if (woke) greet();
  }

  function startOver() {
    cancelSpeech();
    setMessages([]);
    setSessionId(null);
    setCollecting(false);
    setChatSessionId(null);
    setDraftText("");
  }

  return (
    <main className="flex flex-1 flex-col gap-8 bg-gradient-to-b from-zinc-100 to-zinc-200/70 px-4 py-4 font-sans sm:px-6 sm:py-6 dark:from-zinc-950 dark:to-zinc-900">
      <section
        aria-label="Conversation with Secptile"
        className="mx-auto flex h-[calc(100dvh-6.5rem)] min-h-[26rem] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/80 shadow-xl shadow-zinc-900/5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80"
      >
        <header className="flex items-center gap-3 border-b border-zinc-200/70 px-4 py-3 sm:px-5 dark:border-zinc-800">
          <AssistantAvatar size="md" />
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Secptile</h1>
            <AssistantBar
              onTranscript={
                busy ? undefined : (text) => void sendTurn(text, { spoken: true })
              }
            />
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={startOver}
              disabled={busy}
              aria-label="Start over"
              title="Start over"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              <RotateCcw aria-hidden className="h-4 w-4" />
            </button>
          )}
          <VoiceToggle />
        </header>

        <div
          ref={thread}
          role="log"
          aria-label="Messages"
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 sm:px-5"
        >
          <ChatMessage
            message={{
              id: "welcome",
              role: "assistant",
              text: WELCOME,
            }}
          />
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
          {busy && <ThinkingBubble progress={progress} />}
        </div>

        <div className="border-t border-zinc-200/70 p-3 sm:p-4 dark:border-zinc-800">
          <ChatComposer
            value={draftText}
            onChange={setDraftText}
            onVoiceText={handleVoiceText}
            onSubmit={submitDraft}
            busy={busy}
            placeholder={
              sessionId
                ? "Answer in one go…"
                : collecting
                  ? "Tell me about your day…"
                  : "Ask Secptile anything…"
            }
            allowPrivateNotes={collecting && !busy}
          />
        </div>
      </section>

      <div className="mx-auto w-full max-w-4xl">
        <PastDays />
      </div>
    </main>
  );
}
