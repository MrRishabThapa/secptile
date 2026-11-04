"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { TranscriptForm } from "@/components/transcript-form";
import { AssistantBar } from "@/components/assistant-bar";
import { QuestionsStep } from "@/components/questions-step";
import { WAKE_GREETING, detectWakePhrase } from "@/lib/wake";
import { phaseSchema, type Draft } from "@/lib/schema";

type Step = "input" | "questions";

/** Shape of /api/journal's success body — re-validated client-side. */
const apiBodySchema = phaseSchema.extend({ sessionId: z.string().min(1) });
type ApiBody = z.infer<typeof apiBodySchema>;

/**
 * Handoff to Today's Tea once a draft exists: the draft + session ride in
 * sessionStorage for one navigation ("/" reads and clears it).
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
  const [step, setStep] = useState<Step>("input");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [transcript, setTranscript] = useState("");
  const [greeting, setGreeting] = useState<string | null>(null);

  /** Streaming feedback line while OpenCode thinks. */
  const [progress, setProgress] = useState<string | null>(null);

  /** Streaming variant: NDJSON lines — progress ping(s), then the phase. */
  async function callApi(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const response = await fetch("/api/journal/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        // Pre-flight validation errors arrive as plain JSON.
        const json: unknown = await response.json().catch(() => null);
        const message =
          typeof json === "object" && json !== null && "error" in json
            ? String((json as { error: unknown }).error)
            : `Request failed (${response.status})`;
        throw new Error(message);
      }
      if (!response.body) throw new Error("The server stopped streaming early.");

      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = "";
      let phase: ApiBody | null = null;
      while (phase === null) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let index: number;
        while ((index = buffer.indexOf("\n")) !== -1 && phase === null) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line) continue;
          const event: unknown = JSON.parse(line);
          if (
            typeof event === "object" &&
            event !== null &&
            "type" in event &&
            (event as { type: unknown }).type === "progress"
          ) {
            const message = (event as { type: unknown; message?: unknown }).message;
            setProgress(typeof message === "string" ? message : null);
            continue;
          }
          if (
            typeof event === "object" &&
            event !== null &&
            "type" in event &&
            (event as { type: unknown }).type === "error"
          ) {
            let message = "The journal response was malformed. Try again.";
            if (typeof event === "object" && event !== null) {
              const err = (event as { error?: unknown }).error;
              if (typeof err === "string") message = err;
            }
            throw new Error(message);
          }
          // Final phase line — validate exactly like the non-streamed route.
          const candidate = apiBodySchema.safeParse(event);
          if (!candidate.success) {
            throw new Error("The journal response was malformed. Try again.");
          }
          phase = candidate.data;
        }
      }
      reader.releaseLock();
      if (!phase) throw new Error("The journal response was malformed. Try again.");
      return phase;
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function startJournal(input: { transcript: string; privateNotes?: string }) {
    try {
      const data = await callApi({
        transcript: input.transcript,
        privateNotes: input.privateNotes,
      });
      handlePhase(data.sessionId, data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    }
  }

  async function sendAnswers(answers: string[]) {
    if (!sessionId) return;
    try {
      const data = await callApi({ sessionId, answers });
      handlePhase(sessionId, data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
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
      router.push("/");
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
          Speak or type your day. Questions fill the gaps — the draft brews on
          <span className="font-medium text-zinc-700 dark:text-zinc-300"> Today&apos;s Tea</span>.
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
    </main>
  );
}
