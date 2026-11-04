"use client";

import { useEffect, useRef, useState } from "react";
import type { Draft } from "@/lib/schema";
import {
  LINKEDIN_TEXT_LIMIT,
  tagsToHashtags,
} from "@/lib/linkedin-text";

type Status = { configured: boolean; connected: boolean; expiresAt: string | null };
type Resume = { sessionId: string | null; draft: Draft; approved: boolean; transcript: string };

const RESUME_KEY = "secptile:resume";

export function saveLinkedInResume(resume: Resume) {
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify(resume));
  } catch {
    /* private mode etc. — connecting just loses the draft then */
  }
}

export function readLinkedInResume(): Resume | null {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    return raw ? (JSON.parse(raw) as Resume) : null;
  } catch {
    return null;
  }
}

export function clearLinkedInResume() {
  try {
    sessionStorage.removeItem(RESUME_KEY);
  } catch {
    /* ignore */
  }
}

type Props = {
  draft: Draft;
  approved: boolean;
  /** Bumped when the page sees ?linkedin=connected — re-check status. */
  statusKey: number;
  /** Called before the full-page OAuth redirect so the day can be restored. */
  onConnect: () => void;
  /** Links the LinkedIn post to this day's history record. */
  sessionId: string | null;
  /** True once the blog publish succeeded (ordering: blog first, then share). */
  published: boolean;
  /** Cover photo of the day — optional to attach, recommended. */
  photoId: string | null;
};

/**
 * Post the approved day to LinkedIn (Phase 5, official API). Shown only after
 * approval — same hard rule as blog publishing. The text starts from the
 * model's hook-format `linkedin` field and stays editable; the cover photo
 * attach is optional (default on — image posts reach further).
 */
export function LinkedInShare({
  draft,
  approved,
  statusKey,
  onConnect,
  sessionId,
  published,
  photoId,
}: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  /** Set in the status effect (Date.now is not render-safe). */
  const [expired, setExpired] = useState(false);
  const [text, setText] = useState("");
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachPhoto, setAttachPhoto] = useState(true);
  const editedRef = useRef(false);

  // Candidate text follows the model's hook-first LinkedIn text until the
  // user takes over; hashtags are appended at the end.
  const candidate = `${draft.linkedin.trim()}\n\n${tagsToHashtags(draft.tags)}`.trim();
  useEffect(() => {
    if (!editedRef.current) setText(candidate);
  }, [candidate]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/linkedin/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: unknown) => {
        if (cancelled || typeof json !== "object" || json === null) return;
        const next = json as Status;
        setStatus(next);
        setExpired(
          Boolean(
            next.connected && next.expiresAt && Date.parse(next.expiresAt) <= Date.now(),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [statusKey]);

  const chars = text.length;
  const overLimit = chars > LINKEDIN_TEXT_LIMIT;
  const connected = Boolean(status?.connected) && !expired;
  const readyToPost =
    approved &&
    published &&
    connected &&
    !overLimit &&
    text.trim().length > 0 &&
    !busy;

  async function post() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/linkedin/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          visibility: "PUBLIC",
          approved: true,
          sessionId: sessionId ?? undefined,
          photoId: attachPhoto && photoId ? photoId : undefined,
          imageAlt: attachPhoto && photoId ? draft.title.slice(0, 120) : undefined,
        }),
      });
      const json: unknown = await response.json();
      const message =
        typeof json === "object" && json !== null && "error" in json
          ? String((json as { error: unknown }).error)
          : response.ok
            ? ""
            : `Posting failed (${response.status})`;
      const needsReauth =
        typeof json === "object" && json !== null && "needsReauth" in json
          ? (json as { needsReauth: unknown }).needsReauth === true
          : false;
      if (!response.ok) {
        throw new Error(
          `${message}${needsReauth ? " — reconnect LinkedIn and try again." : ""}`,
        );
      }
      const urn =
        typeof json === "object" && json !== null && "postUrn" in json
          ? String((json as { postUrn: unknown }).postUrn)
          : null;
      setResult(urn ?? "posted");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Posting failed.");
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <section className="flex w-full flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Share to LinkedIn
      </h2>

      {status && !status.configured && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Add <code className="font-mono">LINKEDIN_CLIENT_ID</code> and{" "}
          <code className="font-mono">LINKEDIN_CLIENT_SECRET</code> to{" "}
          <code className="font-mono">.env.local</code> to enable this.
        </p>
      )}

      {status?.configured && !status.connected && (
        <a
          href="/api/auth/linkedin/start"
          onClick={onConnect}
          className="w-fit rounded-lg bg-[#0a66c2] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#004182]"
        >
          Connect LinkedIn
        </a>
      )}

      {(status?.configured && (!status.connected || expired)) && (
        <>
          <a
            href="/api/auth/linkedin/start"
            onClick={onConnect}
            className="w-fit rounded-lg bg-[#0a66c2] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#004182]"
          >
            {expired ? "Reconnect LinkedIn" : "Connect LinkedIn"}
          </a>
          {expired && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Your LinkedIn access expired (~60-day tokens, no programmatic
              refresh on this product) — reconnect, then try again.
            </p>
          )}
        </>
      )}

      {connected && (
        <>
          {status?.expiresAt && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Connected until{" "}
              {new Date(status.expiresAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
              .
            </p>
          )}
          {!published && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Publish to Today&apos;s Tea first — the blog is stored before it
              is shared anywhere.
            </p>
          )}

          {photoId && (
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={attachPhoto}
                onChange={(event) => setAttachPhoto(event.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 accent-[#0a66c2]"
              />
              Attach the cover photo to the post
            </label>
          )}

          <textarea
            value={text}
            onChange={(event) => {
              editedRef.current = true;
              setEdited(true);
              setText(event.target.value);
            }}
            rows={10}
            className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 focus:border-[#0a66c2] focus:outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            placeholder="LinkedIn text — the first line should be the hook"
          />
          <p
            className={`text-xs tabular-nums ${
              overLimit ? "text-red-600 dark:text-red-400" : "text-zinc-400 dark:text-zinc-600"
            }`}
          >
            {chars.toLocaleString()} / {LINKEDIN_TEXT_LIMIT.toLocaleString()} characters
            {overLimit && " — trim before posting"}
          </p>

          {result && (
            <p
              role="status"
              className="text-xs text-emerald-700 dark:text-emerald-400"
            >
              Posted ✓ {result !== "posted" && <code className="font-mono">{result}</code>}
              {edited && " — with your edited text"}
              {attachPhoto && photoId && " — with the cover photo"}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          {!result && (
            <button
              type="button"
              onClick={() => {
                if (armed) {
                  void post();
                } else {
                  setArmed(true);
                  window.setTimeout(() => setArmed(false), 6000);
                }
              }}
              disabled={!readyToPost}
              title={approved && published && !connected ? undefined : "Approve, publish, connect — then post."}
              className={`w-fit rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                armed
                  ? "bg-red-700 hover:bg-red-600"
                  : "bg-[#0a66c2] hover:bg-[#004182]"
              }`}
            >
              {busy
                ? "Posting…"
                : armed
                  ? "Confirm — post to LinkedIn now"
                  : "Post to LinkedIn"}
            </button>
          )}
          {result && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              This draft was already posted — recorded in day history. Start a
              new day to post another update.
            </p>
          )}
        </>
      )}
    </section>
  );
}
