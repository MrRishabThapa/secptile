"use client";

import { useState } from "react";
import { z } from "zod";
import { TranscriptForm } from "@/components/transcript-form";
import { QuestionsStep } from "@/components/questions-step";
import { DraftView } from "@/components/draft-view";
import { phaseSchema, type Draft } from "@/lib/schema";

type Step = "input" | "questions" | "draft";

/** Shape of /api/journal's success body — re-validated client-side. */
const apiBodySchema = phaseSchema.extend({ sessionId: z.string().min(1) });
type ApiBody = z.infer<typeof apiBodySchema>;

export default function Home() {
  const [step, setStep] = useState<Step>("input");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);

  async function callApi(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof json === "object" && json !== null && "error" in json
            ? String((json as { error: unknown }).error)
            : `Request failed (${response.status})`;
        throw new Error(message);
      }
      const parsed = apiBodySchema.safeParse(json);
      if (!parsed.success) {
        throw new Error("The journal response was malformed. Try again.");
      }
      return parsed.data;
    } finally {
      setBusy(false);
    }
  }

  function applyPhase(data: ApiBody) {
    if (data.status === "ready" && data.draft) {
      setDraft(data.draft);
      setStep("draft");
    } else {
      setQuestions(data.questions);
      setStep("questions");
    }
  }

  async function startJournal(input: { transcript: string; privateNotes?: string }) {
    try {
      const data = await callApi({
        transcript: input.transcript,
        privateNotes: input.privateNotes,
      });
      setSessionId(data.sessionId);
      applyPhase(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    }
  }

  async function sendAnswers(answers: string[]) {
    if (!sessionId) return;
    try {
      const data = await callApi({ sessionId, answers });
      applyPhase(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    }
  }

  function restart() {
    setStep("input");
    setSessionId(null);
    setQuestions([]);
    setDraft(null);
    setError(null);
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10 font-sans">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Secptile
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Speak your day. Get a blog post. Nothing publishes without your approval.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {step === "input" && !busy && <TranscriptForm busy={busy} onSubmit={startJournal} />}

      {step === "questions" && !busy && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            A few questions to complete the story:
          </p>
          <QuestionsStep
            questions={questions}
            busy={busy}
            onSubmit={sendAnswers}
            onRestart={restart}
          />
        </>
      )}

      {step === "draft" && draft && !busy && <DraftView draft={draft} onRestart={restart} />}
    </main>
  );
}
