"use client";

import { useEffect, useState } from "react";

type Entry = {
  id: string;
  createdAt: string;
  title: string;
  body: string;
  tags: string[];
  transcript?: string;
  portfolioFile: string | null;
  portfolioCommit: string | null;
  linkedInUrn: string | null;
};

/**
 * History of past days (Phase 6): what was journaled, what shipped where.
 * Expanded entry renders the stored markdown as-is — review, not editing.
 */
export function PastDays() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

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

  return (
    <section className="w-full">
      <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900">
          Past days{" "}
          {entries && (
            <span className="text-zinc-400 dark:text-zinc-600">({entries.length})</span>
          )}
        </summary>
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
          {entries === null &&
            Array.from({ length: 2 }, (_, i) => (
              <li key={i} className="px-4 py-3 text-sm text-zinc-400 dark:text-zinc-600">
                loading…
              </li>
            ))}
          {entries?.map((entry) => (
            <li key={entry.id} className="px-4">
              <button
                type="button"
                onClick={() => setOpenId(openId === entry.id ? null : entry.id)}
                className="flex w-full flex-col gap-1 py-3 text-left"
              >
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <time className="font-mono text-xs text-zinc-400 dark:text-zinc-600">
                    {entry.createdAt.slice(0, 10)}
                  </time>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {entry.title}
                  </span>
                  {entry.portfolioFile && (
                    <span
                      title={entry.portfolioFile}
                      className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                    >
                      portfolio
                    </span>
                  )}
                  {entry.linkedInUrn && (
                    <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                      LinkedIn
                    </span>
                  )}
                </span>
              </button>
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
