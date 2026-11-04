"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Coffee } from "lucide-react";
import { DraftEditor } from "@/components/draft-editor";
import { LinkedInPreview } from "@/components/linkedin-preview";
import {
  LinkedInShare,
  clearLinkedInResume,
  readLinkedInResume,
  saveLinkedInResume,
} from "@/components/linkedin-share";
import { callJournalStream, type Draft } from "@/lib/journal-client";

type PublishResult = {
  id: string;
  /** Served cover photo (/api/photos/{photoId}). */
  photoUrl: string;
  portfolio: {
    synced: boolean;
    url: string | null;
    error: string | null;
  };
};

/** Chat handoff: one draft, carried by sessionStorage ("secptile:handoff"). */
const HANDOFF_KEY = "secptile:handoff";

type TeaState = {
  sessionId: string | null;
  draft: Draft | null;
  approved: boolean;
  transcript: string;
  oauthConnected: boolean;
  oauthMessage: string | null;
};

/**
 * Returned to via three doors, each restoring prior state:
 * - the Chat handoff (sessionStorage "secptile:handoff"), or
 * - a Past-days row (same sessionStorage key, legacy drafts acceptable), or
 * - the LinkedIn OAuth redirect (?linkedin=connected, stashed resume).
 */
function restoreState(oauthMessageIn: string | null): TeaState {
  if (typeof window === "undefined") {
    return {
      sessionId: null,
      draft: null,
      approved: false,
      transcript: "",
      oauthConnected: false,
      oauthMessage: null,
    };
  }

  const flag = new URLSearchParams(window.location.search).get("linkedin");
  const connected = flag === "connected";
  const oauthMessage = flag
    ? connected
      ? "LinkedIn connected."
      : "LinkedIn connection failed — check the app credentials and try Connect again."
    : oauthMessageIn;
  if (flag) {
    // Drop the query param so a refresh doesn't double-fire the restore.
    window.history.replaceState(null, "", window.location.pathname);
  }

  // 1) The handoff wins — freshest draft of the day.
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (raw) {
      sessionStorage.removeItem(HANDOFF_KEY);
      const handoff: unknown = JSON.parse(raw);
      const candidate = (handoff as { draft?: unknown }).draft;
      if (candidate && typeof candidate === "object") {
        return {
          sessionId: (handoff as { sessionId?: string | null }).sessionId ?? null,
          draft: candidate as Draft,
          approved: false,
          transcript: "",
          oauthConnected: connected,
          oauthMessage,
        };
      }
    }
  } catch {
    /* corrupt handoff — fall through to the OAuth resume */
  }

  // 2) OAuth resume from before Connect was clicked.
  const resume = readLinkedInResume();
  clearLinkedInResume();
  return {
    sessionId: resume?.sessionId ?? null,
    draft: resume?.draft ?? null,
    approved: resume?.approved ?? false,
    transcript: resume?.transcript ?? "",
    oauthConnected: connected,
    oauthMessage,
  };
}

const initialState = restoreState(null);

export default function TodaysTea() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(initialState.sessionId);
  const [draft, setDraft] = useState<Draft | null>(initialState.draft);
  const [approved, setApproved] = useState(initialState.approved);
  const [transcript, setTranscript] = useState(initialState.transcript);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  /** Cover photo — mandatory before publishing. */
  const [photoId, setPhotoId] = useState<string | null>(null);

  /** Bumped after a successful OAuth return so the share panel re-checks. */
  const [statusKey] = useState(initialState.oauthConnected ? 1 : 0);

  async function regenerate(note: string) {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const data = await callJournalStream({ sessionId, note }, setProgress);
      if (data.status === "ready" && data.draft) {
        setDraft(data.draft);
        setApproved(false); // a regenerated draft must be approved again
        setPublishResult(null);
      } else {
        // The loop wants more info for this day — hand it back to the chat.
        sessionStorage.setItem(
          "secptile:questions",
          JSON.stringify({ sessionId, questions: data.questions }),
        );
        router.push("/");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Regeneration failed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function publish() {
    if (!draft || !photoId) return;
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
          linkedin: draft.linkedin,
          approved: true,
          photoId,
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
      setPublishResult(json as PublishResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Publishing failed.");
    } finally {
      setPublishBusy(false);
    }
  }

  function restart() {
    setDraft(null);
    setSessionId(null);
    setTranscript("");
    setApproved(false);
    setError(null);
    setPublishResult(null);
    setPhotoId(null);
    router.push("/");
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10 font-sans">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Today&apos;s Tea
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Cover photo, edits, approval, and the LinkedIn share — one page.
          Nothing goes anywhere without your explicit approval.
        </p>
      </div>

      {!draft && (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
          <Coffee aria-hidden className="mx-auto h-10 w-10 text-zinc-400 dark:text-zinc-600" />
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            No tea yet for today. When the day&apos;s story is complete, the
            draft lands here for your review.
          </p>
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
        <p
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"
        >
          <span
            aria-hidden
            className="h-2 w-2 animate-pulse rounded-full bg-zinc-400 dark:bg-zinc-600"
          />
          {progress}
        </p>
      )}

      {publishResult && (
        <div
          role="status"
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
        >
          Saved to Today&apos;s Tea — the post and its cover photo are in your
          blog database. Share it on LinkedIn when you&apos;re ready.
          {publishResult.portfolio.synced
            ? " It is also live on your blog site."
            : publishResult.portfolio.error
              ? ` It could not reach your blog site (${publishResult.portfolio.error}) — retry Publish after fixing it.`
              : ""}
        </div>
      )}
      {approved && !publishResult && (
        <div
          role="status"
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
        >
          Approved. Saving and LinkedIn posting happen only after — and always
          gated by — this approval. Nothing has been posted.
        </div>
      )}

      {draft && (
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
            photoId={photoId}
            onPhotoChange={setPhotoId}
          />
          <div className="flex flex-col gap-8">
            <LinkedInPreview
              text={draft.linkedin}
              tags={draft.tags}
              photoUrl={photoId ? `/api/photos/${photoId}` : null}
            />
            <LinkedInShare
              draft={draft}
              approved={approved}
              statusKey={statusKey}
              onConnect={() =>
                draft &&
                saveLinkedInResume({ sessionId, draft, approved, transcript })
              }
              sessionId={sessionId}
              published={Boolean(publishResult)}
              photoId={photoId}
            />
          </div>
        </div>
      )}

      {draft && (
        <button
          type="button"
          onClick={restart}
          className="w-fit text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
        >
          Start over
        </button>
      )}
    </main>
  );
}
