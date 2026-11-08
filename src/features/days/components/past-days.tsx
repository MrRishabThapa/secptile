"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { stripMarkdown, tagsToHashtags } from "@/lib/linkedin/linkedin-text";

type Entry = {
  id: string;
  createdAt: string;
  title: string;
  body: string;
  tags: string[];
  linkedin?: string;
  transcript?: string;
  portfolioFile: string | null;
  portfolioCommit: string | null;
  linkedInUrn: string | null;
};

/**
 * Past days (Phase 6 history): what was journaled, what shipped where.
 * Row actions, per the owner's flow:
 * - click (or Enter, button is focusable) → open the day on Today's Tea to
 *   publish/update the blog and verify the LinkedIn post;
 * - double-click (or the trash icon) → offer to remove the day's record.
 * The expanded markdown view stays behind the small "view" toggle so review
 * is still possible without leaving the page.
 */
export function PastDays() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/history")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`history ${res.status}`))))
      .then((json: { entries?: Entry[] }) => {
        if (!cancelled && Array.isArray(json.entries)) setEntries(json.entries);
      })
      .catch(() => {
        if (!cancelled) setError("History could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (entries && entries.length === 0) return null;
  if (error && entries === null) return null; // history is auxiliary: fail silent

  /**
   * Open the day on Today's Tea. Old records predate the model-generated
   * LinkedIn text — fall back to the flattened body so actionable fields are
   * never empty; the text stays editable on the tea page anyway.
   */
  function open(entry: Entry) {
    try {
      sessionStorage.setItem(
        "secptile:handoff",
        JSON.stringify({
          sessionId: entry.id,
          draft: {
            title: entry.title,
            body: entry.body,
            tags: entry.tags,
            linkedin:
              entry.linkedin ||
              stripMarkdown(entry.body) + "\n\n" + tagsToHashtags(entry.tags),
          },
        }),
      );
    } catch {
      setError("Could not open the day — storage is unavailable.");
      return;
    }
    router.push("/tea");
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/history/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const json: unknown = await response.json().catch(() => null);
        const message =
          typeof json === "object" && json !== null && "error" in json
            ? String((json as { error: unknown }).error)
            : `Delete failed (${response.status})`;
        throw new Error(message);
      }
      setEntries((list) => (list ?? []).filter((entry) => entry.id !== id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delete failed.");
    } finally {
      setBusyId(null);
      setRemoveId(null);
    }
  }

  return (
    <section className="w-full">
      <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900">
          Past days{" "}
          {entries && (
            <span className="text-zinc-400 dark:text-zinc-600">({entries.length})</span>
          )}
        </summary>
        {error && (
          <p role="alert" className="px-4 pb-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
          {entries === null &&
            Array.from({ length: 2 }, (_, i) => (
              <li key={i} className="px-4 py-3 text-sm text-zinc-400 dark:text-zinc-600">
                loading…
              </li>
            ))}
          {entries?.map((entry) => (
            <li key={entry.id} className="px-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(event) => {
                    if (event.detail === 2) {
                      setRemoveId(entry.id);
                      return;
                    }
                    open(entry);
                  }}
                  onDoubleClick={() => setRemoveId(entry.id)}
                  title="Open in Today's Tea to publish and verify"
                  className="flex min-w-0 flex-1 flex-col gap-1 py-3 text-left"
                >
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <time className="font-mono text-xs text-zinc-400 dark:text-zinc-600">
                      {entry.createdAt.slice(0, 10)}
                    </time>
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      {entry.title}
                    </span>
                    {entry.linkedInUrn && (
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                        LinkedIn
                      </span>
                    )}
                  </span>
                </button>

                <button
                  type="button"
                  aria-label={`Remove ${entry.title}`}
                  title="Remove this day"
                  onClick={() => {
                    if (removeId === entry.id) {
                      void remove(entry.id);
                    } else {
                      setRemoveId(entry.id);
                      setOpenId((open) => (open === entry.id ? open : open));
                      window.setTimeout(
                        () => setRemoveId((armed) => (armed === entry.id ? null : armed)),
                        6000,
                      );
                    }
                  }}
                  disabled={busyId === entry.id}
                  className={`shrink-0 rounded-md p-1.5 transition-colors disabled:opacity-40 ${
                    removeId === entry.id
                      ? "text-white bg-red-700 hover:bg-red-600"
                      : "text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800 dark:hover:text-red-400"
                  }`}
                >
                  <Trash2 aria-hidden size={16} />
                </button>
              </div>

              {removeId === entry.id && (
                <div className="flex items-center gap-3 pb-3 text-xs">
                  <span className="text-zinc-600 dark:text-zinc-300">
                    Remove this day from history? The blog database and LinkedIn
                    keep their copies.
                  </span>
                  <button
                    type="button"
                    disabled={busyId === entry.id}
                    onClick={() => void remove(entry.id)}
                    className="rounded-lg bg-red-700 px-3 py-1 font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-40"
                  >
                    {busyId === entry.id ? "Removing…" : "Confirm remove"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoveId(null)}
                    className="text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {openId === entry.id && (
                <div className="pb-4">
                  <div className="whitespace-pre-wrap rounded-lg bg-zinc-50 px-4 py-3 text-sm leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                    {entry.body}
                  </div>
                  {entry.transcript && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-zinc-400 dark:text-zinc-600">
                        original transcript
                      </summary>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-500 dark:text-zinc-400">
                        {entry.transcript}
                      </p>
                    </details>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
