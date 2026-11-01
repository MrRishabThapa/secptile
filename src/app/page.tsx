"use client";

import { useState } from "react";
import { z } from "zod";
import { TranscriptForm } from "@/components/transcript-form";
import { QuestionsStep } from "@/components/questions-step";
import { DraftEditor } from "@/components/draft-editor";
import { LinkedInPreview } from "@/components/linkedin-preview";
import { WAKE_GREETING, detectWakePhrase } from "@/lib/wake";
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
  const [transcript, setTranscript] = useState("");
  const [greeting, setGreeting] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);

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
      setApproved(false); // a fresh draft must be approved again
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

  async function regenerate(note: string) {
    if (!sessionId) return;
    try {
      const data = await callApi({ sessionId, note });
      applyPhase(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    }
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
    setDraft(null);
    setTranscript("");
    setGreeting(null);
    setApproved(false);
    setError(null);
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10 font-sans">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Secptile
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Speak your day. Get a blog post. Nothing publishes without your approval.
        </p>
      </header>

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

      {step === "input" && !busy && (
        <div className="max-w-2xl">
          <TranscriptForm
            busy={busy}
            transcript={transcript}
            onTranscriptChange={handleTranscript}
            onSubmit={startJournal}
          />
        </div>
      )}

      {step === "questions" && !busy && (
        <div className="max-w-2xl">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            A few questions to complete the story:
          </p>
          <QuestionsStep
            questions={questions}
            busy={busy}
            onSubmit={sendAnswers}
            onRestart={restart}
          />
        </div>
      )}

      {step === "draft" && draft && !busy && (
        <>
          {approved && (
            <div
              role="status"
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
            >
              Approved. Publishing to the portfolio (Phase 4) and LinkedIn (Phase 5) happens
              only after — and always gated by — this approval. Nothing has been posted.
            </div>
          )}
          <div className="grid w-full grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
            <DraftEditor
              draft={draft}
              approved={approved}
              busy={busy}
              onSave={setDraft}
              onApprove={() => setApproved(true)}
              onWithdrawApproval={() => setApproved(false)}
              onRegenerate={regenerate}
            />
            <LinkedInPreview body={draft.body} tags={draft.tags} />
          </div>

          <button
            type="button"
            onClick={restart}
            className="w-fit text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
          >
            Start over
          </button>
        </>
      )}
    </main>
  );
}
