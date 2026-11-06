"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  Database,
  Package,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  PENDING_UPDATES_SCHEMA,
  UPDATE_THREAD_SCHEMA,
  type PendingUpdates,
  type UpdateThread,
} from "@/lib/updates-schema";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${gib.toFixed(1)} GiB`;
  const mib = bytes / 1024 ** 2;
  if (mib >= 1) return `${mib.toFixed(1)} MiB`;
  return `${Math.round(bytes / 1024)} KiB`;
}

/** Thread-fetch state per opened package — fetched once, then cached. */
interface ThreadEntry {
  status: "loading" | "ready" | "error";
  thread?: UpdateThread;
}

export default function UpdatesPage() {
  const [pending, setPending] = useState<PendingUpdates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [openName, setOpenName] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, ThreadEntry>>({});
  const abortRef = useRef<Map<string, AbortController>>(new Map());

  const loadPending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/updates", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setPending(PENDING_UPDATES_SCHEMA.parse(await response.json()));
    } catch {
      setError("Could not read pending updates — is the machine running pacman?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPending();
    return () => {
      for (const controller of abortRef.current.values()) controller.abort();
    };
  }, [loadPending]);

  const loadThread = useCallback(async (name: string) => {
    if (threads[name]) return; // already loaded (or loading)
    const controller = new AbortController();
    abortRef.current.set(name, controller);
    setThreads((prev) => ({ ...prev, [name]: { status: "loading" } }));
    try {
      const response = await fetch(`/api/updates/${encodeURIComponent(name)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const thread = UPDATE_THREAD_SCHEMA.parse(await response.json());
      setThreads((prev) => ({ ...prev, [name]: { status: "ready", thread } }));
    } catch (fetchError) {
      if ((fetchError as Error).name === "AbortError") return;
      setThreads((prev) => ({ ...prev, [name]: { status: "error" } }));
    }
  }, [threads]);

  const toggle = useCallback((name: string) => {
    setOpenName((current) => {
      const next = current === name ? null : name;
      if (next) void loadThread(next);
      return next;
    });
  }, [loadThread]);

  if (loading && !pending) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-3 px-6 py-10 font-sans">
        <RefreshCw aria-hidden className="h-5 w-5 animate-spin text-zinc-400" />
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Checking what the system wants to tell you…</p>
      </main>
    );
  }

  if (error && !pending) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-4 px-6 py-10 font-sans">
        <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>
        <button
          type="button"
          onClick={() => void loadPending()}
          className="flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <RefreshCw aria-hidden className="h-3.5 w-3.5" />
          Try again
        </button>
      </main>
    );
  }

  if (!pending) return null;

  const lowerQuery = query.trim().toLowerCase();
  const visible = lowerQuery
    ? pending.updates.filter((update) => update.name.toLowerCase().includes(lowerQuery))
    : pending.updates;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10 font-sans">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Updates
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Open a package to see what it is, what it needs, and what changes when it
            lands. Read-only — installing stays a manual call.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPending()}
          aria-pressed={loading}
          className="flex items-center gap-1.5 self-start rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <RefreshCw aria-hidden className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Re-check
        </button>
      </div>

      <label className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 shadow-sm focus-within:border-zinc-400 dark:border-zinc-800 dark:bg-[#1d1f1e] dark:focus-within:border-zinc-600">
        <Search aria-hidden className="h-4 w-4 shrink-0 text-zinc-400" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by package name…"
          aria-label="Filter updates by package name"
          className="w-full bg-transparent text-sm text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-200"
        />
      </label>

      <div
        className="flex items-center gap-2 text-sm"
        role="status"
        aria-live="polite"
      >
        <Package aria-hidden className="h-4 w-4 text-zinc-400" />
        <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{pending.updates.length}</span>
        <span className="text-zinc-500 dark:text-zinc-400">
          updates pending on {pending.hostname}
          {(visible.length !== pending.updates.length || query) &&
            ` · ${visible.length} shown`}
        </span>
      </div>

      <ol className="flex flex-col gap-2" aria-label="Pending updates">
        {visible.map((update) => {
          const open = openName === update.name;
          const entry = threads[update.name];
          const thread = entry?.thread;
          return (
            <li key={update.name}>
              <div
                className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-colors dark:bg-[#1d1f1e] ${
                  open
                    ? "border-zinc-300 dark:border-zinc-600"
                    : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-600"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggle(update.name)}
                  aria-expanded={open}
                  aria-controls={`thread-${update.name}`}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <ChevronDown
                    aria-hidden
                    className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "" : "-rotate-90"}`}
                  />
                  <span
                    className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100"
                    title={update.name}
                  >
                    {update.name}
                  </span>
                  <span className="ml-auto hidden shrink-0 items-center gap-2 font-mono text-xs tabular-nums text-zinc-500 sm:flex dark:text-zinc-400">
                    {update.currentVersion}
                    <ArrowRight aria-hidden className="h-3 w-3" />
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200">{update.newVersion}</span>
                  </span>
                </button>

                {open && (
                  <div
                    id={`thread-${update.name}`}
                    className="flex flex-col gap-4 border-t border-zinc-100 px-4 py-4 dark:border-zinc-800"
                  >
                    {entry?.status !== "ready" && (
                      <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                        <RefreshCw
                          aria-hidden
                          className={`h-3.5 w-3.5 ${entry?.status === "loading" ? "animate-spin" : ""}`}
                        />
                        {entry?.status === "error"
                          ? "Could not read this package — try closing and reopening."
                          : "Reading the package record…"}
                      </p>
                    )}
                    {entry?.status === "ready" && thread && (
                      <>
                        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                          {thread.description ?? "No description in the package record."}
                        </p>
                        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                          <div className="flex items-baseline justify-between gap-3 sm:block">
                            <dt className="text-zinc-500 dark:text-zinc-400 sm:mb-0.5">Changes</dt>
                            <dd className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-zinc-800 dark:text-zinc-200">
                              {update.currentVersion}
                              <ArrowRight aria-hidden className="h-3 w-3 text-zinc-400" />
                              <span className="font-semibold">{update.newVersion}</span>
                            </dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-3 sm:block">
                            <dt className="text-zinc-500 dark:text-zinc-400 sm:mb-0.5">Repository</dt>
                            <dd className="font-mono text-xs text-zinc-800 dark:text-zinc-200">{thread.repo}</dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-3 sm:block">
                            <dt className="text-zinc-500 dark:text-zinc-400 sm:mb-0.5">Install size</dt>
                            <dd className="font-mono text-xs tabular-nums text-zinc-800 dark:text-zinc-200">
                              {formatBytes(thread.installSizeBytes)}
                            </dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-3 sm:block">
                            <dt className="text-zinc-500 dark:text-zinc-400 sm:mb-0.5">Install reason</dt>
                            <dd className="text-xs text-zinc-800 dark:text-zinc-200">{thread.installReason ?? "—"}</dd>
                          </div>
                        </dl>
                        {thread.dependencies.length > 0 && (
                          <div>
                            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                              <Database aria-hidden className="h-3 w-3" />
                              Depends on
                            </p>
                            <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                              {thread.dependencies.join(" · ")}
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="rounded-xl border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-[#1d1f1e] dark:text-zinc-400">
            {query ? `No pending updates match “${query}”.` : "Nothing to update — you are fully caught up."}
          </li>
        )}
      </ol>
    </main>
  );
}
