"use client";

import { useState } from "react";
import { z } from "zod";
import { TranscriptForm } from "@/components/transcript-form";
import { QuestionsStep } from "@/components/questions-step";
import { PastDays } from "@/components/past-days";
import { DraftEditor } from "@/components/draft-editor";
import { LinkedInPreview } from "@/components/linkedin-preview";
import {
  LinkedInShare,
  clearLinkedInResume,
  readLinkedInResume,
  saveLinkedInResume,
} from "@/components/linkedin-share";
import { WAKE_GREETING, detectWakePhrase } from "@/lib/wake";
import { phaseSchema, type Draft } from "@/lib/schema";

type Step = "input" | "questions" | "draft";
type PublishResult = {
  file: string;
  commitHash: string | null;
  pushed: boolean;
  pushError: string | null;
};

/** Shape of /api/journal's success body — re-validated client-side. */
const apiBodySchema = phaseSchema.extend({ sessionId: z.string().min(1) });
type ApiBody = z.infer<typeof apiBodySchema>;

/**
 * Returning from the LinkedIn OAuth redirect: the browser lands back on "/"
 * with ?linkedin=connected|error, and an in-progress day was stashed in
 * sessionStorage before the redirect (see onConnect below). Restore it.
 */
function resumeIfOAuthReturn(): {
  step: Step;
  draft: Draft | null;
  approved: boolean;
  transcript: string;
  sessionId: string | null;
  oauthConnected: boolean;
  oauthMessage: string | null;
} {
  if (typeof window === "undefined") {
    return {
      step: "input",
      draft: null,
      approved: false,
      transcript: "",
      sessionId: null,
      oauthConnected: false,
      oauthMessage: null,
    };
  }
  const flag = new URLSearchParams(window.location.search).get("linkedin");
  if (!flag) {
    return {
      step: "input",
      draft: null,
      approved: false,
      transcript: "",
      sessionId: null,
      oauthConnected: false,
      oauthMessage: null,
    };
  }
  // Drop the query param so a refresh doesn't double-fire the restore.
  window.history.replaceState(null, "", window.location.pathname);

  const resume = readLinkedInResume();
  clearLinkedInResume();
  const connected = flag === "connected";
  return {
    step: resume && connected ? "draft" : "input",
    draft: resume?.draft ?? null,
    approved: resume?.approved ?? false,
    transcript: resume?.transcript ?? "",
    sessionId: resume?.sessionId ?? null,
    oauthConnected: connected,
    oauthMessage: connected
      ? "LinkedIn connected ✓"
      : "LinkedIn connection failed — check the app credentials and try Connect again.",
  };
}

const initialState = resumeIfOAuthReturn();

export default function Home() {
  const [step, setStep] = useState<Step>(initialState.step);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(initialState.sessionId);
  const [questions, setQuestions] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(initialState.draft);
  const [transcript, setTranscript] = useState(initialState.transcript);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [approved, setApproved] = useState(initialState.approved);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  /** Bumped after a successful OAuth return so the share panel re-checks. */
  const [statusKey] = useState(initialState.oauthConnected ? 1 : 0);

  /** Streaming feedback line while OpenCode thinks (6–20s). */
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
          // Final phase line — validate exactly like /api/journal did.
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

  async function publish() {
    if (!draft) return;
    setPublishBusy(true);
    setError(null);
    setPublishResult(null);
    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          body: draft.body,
          tags: draft.tags,
          approved: true,
          sessionId: sessionId ?? undefined,
        }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof json === "object" && json !== null && "error" in json
            ? String((json as { error: unknown }).error)
            : `Publish failed (${response.status})`;
        throw new Error(message);
      }
      const result = json as PublishResult;
      setPublishResult(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Publishing failed.");
    } finally {
      setPublishBusy(false);
    }
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
    setPublishResult(null);
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

      {initialState.oauthMessage && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            initialState.oauthConnected
              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
          }`}
        >
          {initialState.oauthMessage}
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
            key={sessionId ?? "questions"}
            questions={questions}
            busy={busy}
            onSubmit={sendAnswers}
            onRestart={restart}
          />
        </div>
      )}

      {step === "draft" && draft && !busy && (
        <>
          {publishResult && (
            <div
              role="status"
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
            >
              Published to the portfolio:{" "}
              <code className="font-mono">{publishResult.file}</code>{" "}
              (commit{" "}
              <code className="font-mono">{publishResult.commitHash ?? "?"}</code>
              {publishResult.pushed
                ? ", pushed ✅"
                : publishResult.pushError
                  ? `, not pushed — ${publishResult.pushError} (run git push in the portfolio repo)`
                  : ""}
              ).
            </div>
          )}
          {approved && !publishResult && (
            <div
              role="status"
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
            >
              Approved. Publishing to the portfolio and posting to LinkedIn happen
              only after — and always gated by — this approval. Nothing has been posted.
            </div>
          )}
          <div className="grid w-full grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
            <DraftEditor
              key={sessionId ?? "draft"}
              draft={draft}
              approved={approved}
              busy={busy}
              onSave={setDraft}
              onApprove={() => setApproved(true)}
              onWithdrawApproval={() => setApproved(false)}
              onRegenerate={regenerate}
              onPublish={approved ? publish : undefined}
              publishBusy={publishBusy}
            />
            <div className="flex flex-col gap-8">
              <LinkedInPreview body={draft.body} tags={draft.tags} />
              <LinkedInShare
                draft={draft}
                approved={approved}
                statusKey={statusKey}
                onConnect={() =>
                  draft &&
                  saveLinkedInResume({ sessionId, draft, approved, transcript })
                }
                sessionId={sessionId}
              />
            </div>
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

      <PastDays />
    </main>
  );
}
