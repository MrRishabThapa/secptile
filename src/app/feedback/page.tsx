"use client";

import { useCallback, useEffect, useState } from "react";
import { PartyPopper } from "lucide-react";

type PendingComment = {
  id: number;
  authorName: string;
  message: string;
  createdAt: string;
  postTitle: string | null;
  postSlug: string | null;
};

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300/50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-600";

export default function FeedbackPage() {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [pending, setPending] = useState<PendingComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Per-comment action state, keyed by the comment id. */
  const [busyId, setBusyId] = useState<number | null>(null);
  const [armedId, setArmedId] = useState<number | null>(null);
  /** Inline edit state. */
  const [editId, setEditId] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [messageDraft, setMessageDraft] = useState("");

  const load = useCallback(async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/feedback");
      const json: unknown = await response.json();
      const message =
        typeof json === "object" && json !== null && "error" in json
          ? String((json as { error: unknown }).error)
          : `Request failed (${response.status})`;
      if (!response.ok) throw new Error(message);
      const data = json as { configured: boolean; pending: PendingComment[] };
      setConfigured(data.configured);
      setPending(data.pending);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load feedback.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(
    id: number,
    action: "approve" | "delete",
    method: "POST",
    body: Record<string, unknown>,
  ) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch("/api/feedback", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof json === "object" && json !== null && "error" in json
            ? String((json as { error: unknown }).error)
            : `Request failed (${response.status})`;
        throw new Error(message);
      }
      setPending((list) => list.filter((comment) => comment.id !== id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed.");
    } finally {
      setBusyId(null);
      setArmedId(null);
    }
  }

  function beginEdit(comment: PendingComment) {
    setEditId(comment.id);
    setArmedId(null);
    setNameDraft(comment.authorName);
    setMessageDraft(comment.message);
  }

  async function saveEdit(id: number) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          authorName: nameDraft,
          message: messageDraft,
        }),
      });
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof json === "object" && json !== null && "error" in json
            ? String((json as { error: unknown }).error)
            : `Request failed (${response.status})`;
        throw new Error(message);
      }
      setPending((list) =>
        list.map((comment) =>
          comment.id === id
            ? { ...comment, authorName: nameDraft, message: messageDraft }
            : comment,
        ),
      );
      setEditId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10 font-sans">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Feedback
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Pending comments from your portfolio blog. Approving publishes them
            on the live post; deleting removes them forever.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {!configured && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
          Not configured yet — paste your Supabase <code className="font-mono">
          service_role</code> key as <code className="font-mono">
          SUPABASE_SERVICE_ROLE_KEY</code> in <code className="font-mono">
          .env.local</code>, then restart the app.
        </div>
      )}

      {loading && (
        <p role="status" aria-live="polite" className="text-sm text-zinc-500 dark:text-zinc-400">
          Loading pending comments…
        </p>
      )}

      {!loading && configured && pending.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
          <PartyPopper aria-hidden className="mx-auto h-10 w-10 text-zinc-400 dark:text-zinc-600" />
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            All caught up — no pending comments on your blog.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {pending.map((comment) => (
          <article
            key={comment.id}
            className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-[#1d1f1e]"
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0a66c2] to-[#004182] text-sm font-bold text-white"
              >
                {comment.authorName.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                {editId === comment.id ? (
                  <input
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.target.value)}
                    maxLength={60}
                    disabled={busyId === comment.id}
                    className={inputClass}
                    aria-label="Commenter name"
                  />
                ) : (
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {comment.authorName}
                  </p>
                )}
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  on{" "}
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {comment.postTitle ?? "a post"}
                  </span>{" "}
                  ·{" "}
                  {new Date(comment.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>

            {editId === comment.id ? (
              <textarea
                value={messageDraft}
                onChange={(event) => setMessageDraft(event.target.value)}
                maxLength={1000}
                rows={3}
                disabled={busyId === comment.id}
                className={`${inputClass} resize-y`}
                aria-label="Comment message"
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                {comment.message}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {editId === comment.id ? (
                <>
                  <button
                    type="button"
                    disabled={busyId === comment.id}
                    onClick={() => void saveEdit(comment.id)}
                    className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    {busyId === comment.id ? "Saving…" : "Save edit"}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === comment.id}
                    onClick={() => setEditId(null)}
                    className="rounded-lg border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busyId === comment.id}
                    onClick={() =>
                      void act(comment.id, "approve", "POST", {
                        id: comment.id,
                        action: "approve",
                      })
                    }
                    className="rounded-lg bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    {busyId === comment.id ? "Working…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === comment.id}
                    onClick={() => beginEdit(comment)}
                    className="rounded-lg border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busyId === comment.id}
                    onClick={() => {
                      if (armedId === comment.id) {
                        void act(comment.id, "delete", "POST", {
                          id: comment.id,
                          action: "delete",
                        });
                      } else {
                        setArmedId(comment.id);
                        window.setTimeout(
                          () => setArmedId((armed) => (armed === comment.id ? null : armed)),
                          6000,
                        );
                      }
                    }}
                    className={`rounded-lg px-4 py-1.5 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      armedId === comment.id
                        ? "bg-red-700 hover:bg-red-600"
                        : "bg-red-600/80 hover:bg-red-600"
                    }`}
                  >
                    {armedId === comment.id ? "Confirm delete" : "Delete"}
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
