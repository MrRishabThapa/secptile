"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TranscriptForm } from "@/features/voice/components/transcript-form";
import { AssistantBar } from "@/features/assistant/components/assistant-bar";
import { QuestionsStep } from "@/features/voice/components/questions-step";
import { PastDays } from "@/features/days/components/past-days";
import { WAKE_GREETING, detectWakePhrase } from "@/lib/journal/wake";
import { callJournalStream, type ApiBody, type Draft } from "@/lib/journal/journal-client";

type Step = "input" | "questions";

/**
 * Handoff to Today's Tea once a draft exists: the draft + session ride in
 * sessionStorage for one navigation ("/tea" reads and clears it).
 */
const HANDOFF_KEY = "secptile:handoff";

function stashHandoff(sessionId: string | null, draft: Draft) {
  try {
    sessionStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({ sessionId, draft }),
    );
  } catch {
    /* private mode — the day must be redone in that case */
  }
}

export default function ChatPage() {
  const router = useRouter();
  /**
   * Returning from Today's Tea: a regeneration note left the loop with open
   * questions. Stashed by the tea page under "secptile:questions" before the
   * navigation; read ONCE here and cleared.
   */
  const [restored] = useState(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem("secptile:questions");
      if (!raw) return null;
      sessionStorage.removeItem("secptile:questions");
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as { sessionId?: unknown }).sessionId === "string" &&
        Array.isArray((parsed as { questions?: unknown }).questions)
      ) {
        return parsed as { sessionId: string; questions: string[] };
      }
    } catch {
      /* ignore */
    }
    return null;
  });
  const [step, setStep] = useState<Step>(restored ? "questions" : "input");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(restored?.sessionId ?? null);
  const [questions, setQuestions] = useState<string[]>(restored?.questions ?? []);
  const [transcript, setTranscript] = useState("");
  const [greeting, setGreeting] = useState<string | null>(null);

  /** Streaming feedback line while OpenCode thinks. */
  const [progress, setProgress] = useState<string | null>(null);

  async function startJournal(input: { transcript: string; privateNotes?: string }) {
    try {
      setBusy(true);
      const data = await callJournalStream(
        {
          transcript: input.transcript,
          privateNotes: input.privateNotes,
        },
        setProgress,
      );
      handlePhase(data.sessionId, data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function sendAnswers(answers: string[]) {
    if (!sessionId) return;
    try {
      setBusy(true);
      const data = await callJournalStream({ sessionId, answers }, setProgress);
      handlePhase(sessionId, data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  /**
   * Drafts leave this page immediately: Today's Tea owns the editor,
   * approval, and LinkedIn sharing.
   */
  function handlePhase(id: string | null, data: ApiBody) {
    setSessionId(id);
    if (data.status === "ready" && data.draft) {
      stashHandoff(id, data.draft);
      router.push("/tea");
      return;
    }
    setQuestions(data.questions);
    setStep("questions");
  }

  /**
   * Wake-phrase check after every transcription (AGENTS.md §9): when the
   * transcript starts the session, greet and keep any extra speech.
   */
  function handleTranscript(text: string) {
    const { woke, remainder } = detectWakePhrase(text);
    setTranscript(remainder);
    if (woke) setGreeting(WAKE_GREETING);
  }

  function restart() {
    setStep("input");
    setSessionId(null);
    setQuestions([]);
    setTranscript("");
    setGreeting(null);
    setError(null);
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10 font-sans">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Chat with Secptile
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Speak or type your day. Questions fill the gaps — the finished draft
          goes to <span className="font-medium text-zinc-700 dark:text-zinc-300">Today&apos;s Tea</span>.
        </p>
      </div>

      {greeting && (
        <div
          role="status"
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
        >
          {greeting}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {progress && (
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <span
            aria-hidden
            className="h-2 w-2 animate-pulse rounded-full bg-zinc-400 dark:bg-zinc-600"
          />
          {progress}
        </p>
      )}

      {step === "input" && (
        <div className="max-w-2xl">
          {/*
            Desktop assistant (Phase 6): the onTranscript handover is only wired
            on the idle input step — never mid-questions — so a spoken update
            can never hijack an ongoing flow.
          */}
          <AssistantBar
            onTranscript={
              !busy ? (text) => void startJournal({ transcript: text }) : undefined
            }
          />
          <TranscriptForm
            busy={busy}
            transcript={transcript}
            onTranscriptChange={handleTranscript}
            onSubmit={startJournal}
          />
        </div>
      )}

      {step === "questions" && (
        <div className="max-w-2xl">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            A few questions to complete the story:
          </p>
          <QuestionsStep
            key={sessionId ?? "questions"}
            questions={questions}
            busy={busy}
            onSubmit={sendAnswers}
            onRestart={restart}
          />
        </div>
      )}

      <PastDays />
    </main>
  );
}
