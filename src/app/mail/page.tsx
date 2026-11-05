"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Inbox, Paperclip, RefreshCw, Search } from "lucide-react";

/**
 * Unified read-only inbox (Phase 7a): All / Gmail / Zoho switcher, search,
 * unread badges, pagination. Connect buttons go straight to the provider's
 * OAuth login route; nothing here can send or modify — this phase is strictly
 * read-only.
 */

type ProviderId = "google" | "zoho";

type ProviderStatus = {
  id: ProviderId;
  label: string;
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  needsReconnect: boolean;
};

type Issue = {
  provider: ProviderId;
  code: "not_configured" | "not_connected" | "error";
  message: string;
  needsReconnect: boolean;
};

type Row = {
  id: string;
  accountId: ProviderId;
  accountEmail: string;
  from: { name?: string; email: string } | null;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  hasAttachments: boolean;
};

type ListResponse = { items: Row[]; nextCursor: string | null; issues: Issue[] };

type Switcher = "all" | "google" | "zoho";

const SWITCHER: { value: Switcher; label: string }[] = [
  { value: "all", label: "All" },
  { value: "google", label: "Gmail" },
  { value: "zoho", label: "Zoho" },
];

const PROVIDER_LABEL: Record<ProviderId, string> = {
  google: "Gmail",
  zoho: "Zoho",
};

/** Flag flash text for post-OAuth landings (?mail=…), cleared from the URL. */
const FLAGS: Record<string, { tone: "ok" | "error"; text: string }> = {
  connected: {
    tone: "ok",
    text: "Mail account connected — the inbox below is live.",
  },
  dc_mismatch: {
    tone: "error",
    text: "Zoho data-center mismatch: the account lives on a different Zoho region than the app expects. Set ZOHO_ACCOUNTS_DOMAIN and ZOHO_MAIL_API_DOMAIN to that region (see .env.example), then connect again.",
  },
  error: {
    tone: "error",
    text: "Could not complete the mail connection — details are in the app server logs. Nothing was stored.",
  },
};

function formatDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const now = new Date();
  const sameDay =
    now.getFullYear() === new Date(ms).getFullYear() &&
    now.getMonth() === new Date(ms).getMonth() &&
    now.getDate() === new Date(ms).getDate();
  return new Intl.DateTimeFormat(undefined, sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short" }).format(ms);
}

export default function MailPage() {
  const [provider, setProvider] = useState<Switcher>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [moreBusy, setMoreBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  // Suppresses the listener race between the debounce and the switcher.
  const requestId = useRef(0);

  // Read the OAuth landing flag once, then strip it from the URL so a
  // refresh doesn't re-flash the same banner.
  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get("mail");
    if (flag && FLAGS[flag]) {
      setFlash(FLAGS[flag]);
      window.history.replaceState(null, "", "/mail");
    }
  }, []);

  const loadStatus = useCallback(() => {
    void fetch("/api/mail/status")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("status"))))
      .then((json: { providers?: ProviderStatus[] }) => {
        if (Array.isArray(json.providers)) setStatuses(json.providers);
      })
      .catch(() => setStatuses([]));
  }, []);

  const load = useCallback(
    (opts: { reset: boolean; cursor?: string | null }) => {
      const id = ++requestId.current;
      if (opts.reset) {
        setLoading(true);
        setRows([]);
      } else {
        setMoreBusy(true);
      }
      setLoadError(null);
      const params = new URLSearchParams({
        provider,
        pageSize: "25",
      });
      if (opts.cursor) params.set("cursor", opts.cursor);
      if (search) params.set("search", search);
      void fetch(`/api/mail/list?${params.toString()}`)
        .then((res) => res.json()) // list always answers JSON (200/400)
        .then((json: ListResponse & { error?: string }) => {
          if (id !== requestId.current) return;
          if (json.error) {
            setLoadError(json.error);
            if (opts.reset) setRows([]);
            return;
          }
          setIssues(json.issues ?? []);
          setNextCursor(json.nextCursor ?? null);
          setRows((previous) =>
            opts.reset ? (json.items ?? []) : [...previous, ...(json.items ?? [])],
          );
        })
        .catch(() => {
          if (id === requestId.current) setLoadError("Could not load the inbox.");
        })
        .finally(() => {
          if (id === requestId.current) {
            setLoading(false);
            setMoreBusy(false);
          }
        });
    },
    [provider, search],
  );

  // Switching accounts or committing a search resets pagination.
  useEffect(() => {
    load({ reset: true });
  }, [load]);

  // Initial + re-refreshable status; effects, not render bodies, do I/O.
  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Debounce the search box into the committed search the list fetches with.
  useEffect(() => {
    if (search === searchInput.trim()) return;
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  /** Refresh resets pagination too (provider may have moved messages). */
  const refresh = useCallback(() => {
    loadStatus();
    load({ reset: true });
  }, [load, loadStatus]);

  const pills = useMemo(
    () =>
      (["google", "zoho"] as ProviderId[])
        .map((id) => {
          const status = statuses.find((s) => s.id === id);
          // Unconfigured providers stay in the issues banner only — clicking
          // Connect without env creds would land on the login route's honest
          // 500, which is not an action.
          if (!status || !status.configured) return null;
          if (status.connected && !status.needsReconnect) return null;
          return { id, status };
        })
        .filter((p): p is { id: ProviderId; status: ProviderStatus } => p !== null),
    [statuses],
  );

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Inbox className="size-5 text-zinc-500 dark:text-zinc-400" aria-hidden />
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Mail
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
              aria-hidden
            />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search mail"
              aria-label="Search mail"
              className="w-56 rounded-full border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder-zinc-500"
            />
          </label>
          <button
            type="button"
            onClick={refresh}
            aria-label="Refresh inbox"
            className="rounded-full border border-zinc-200 p-2 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <RefreshCw className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {flash && (
        <div
          role="status"
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
            flash.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          }`}
        >
          {flash.text}
          <button
            type="button"
            onClick={() => setFlash(null)}
            className="ml-3 underline underline-offset-2"
          >
            dismiss
          </button>
        </div>
      )}

      {pills.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {pills.map(({ id, status }) => (
            <a
              key={id}
              href={`/api/mail/${id}/login`}
              className="rounded-full border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {status.needsReconnect ? `Reconnect ${PROVIDER_LABEL[id]}` : `Connect ${PROVIDER_LABEL[id]}`}
              {status.accountEmail ? ` (${status.accountEmail})` : ""}
            </a>
          ))}
        </div>
      )}

      <div className="mb-4 inline-flex rounded-full border border-zinc-200 p-1 dark:border-zinc-700">
        {SWITCHER.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setProvider(tab.value)}
            aria-pressed={provider === tab.value}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              provider === tab.value
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {issues.map((issue) => (
        <div
          key={`${issue.provider}-${issue.code}`}
          className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
        >
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {PROVIDER_LABEL[issue.provider]}:
          </span>{" "}
          {issue.message}
          {issue.needsReconnect && (
            <a href={`/api/mail/${issue.provider}/login`} className="ml-2 underline underline-offset-2">
              Reconnect {PROVIDER_LABEL[issue.provider]}
            </a>
          )}
        </div>
      ))}

      {loadError && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {loadError}
        </div>
      )}

      <ul className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
        {rows.map((row) => (
          <li
            key={row.id}
            className={`flex items-start gap-3 border-b border-zinc-100 px-4 py-3 last:border-b-0 dark:border-zinc-800/70 ${
              row.unread ? "bg-white dark:bg-zinc-900" : "bg-zinc-50/60 dark:bg-zinc-950/40"
            }`}
          >
            <span
              aria-hidden
              className={`mt-2 size-2 shrink-0 rounded-full ${
                row.unread ? "bg-sky-500" : "bg-transparent"
              }`}
            />
            <div className="w-44 shrink-0 truncate pt-0.5 text-sm">
              <span className={`truncate ${row.unread ? "font-semibold text-zinc-900 dark:text-zinc-50" : "text-zinc-700 dark:text-zinc-300"}`}>
                {row.from?.name || row.from?.email || "(unknown sender)"}
              </span>
              <span className="ml-1.5 rounded bg-zinc-100 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {PROVIDER_LABEL[row.accountId]}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm ${row.unread ? "font-semibold text-zinc-900 dark:text-zinc-50" : "text-zinc-700 dark:text-zinc-300"}`}>
                {row.subject}
              </p>
              <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">{row.snippet}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {row.hasAttachments && <Paperclip className="size-3.5" aria-hidden />}
              <time dateTime={row.date || undefined}>{formatDate(row.date)}</time>
            </div>
          </li>
        ))}
        {loading && (
          <li className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Loading mailbox…
          </li>
        )}
        {!loading && rows.length === 0 && issues.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Inbox is empty for this view.
          </li>
        )}
        {!loading && rows.length === 0 && issues.some((i) => i.code !== "error") && (
          <li className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Connect an account above to fill this inbox.
          </li>
        )}
      </ul>

      {nextCursor && !loading && (
        <div className="mt-4 text-center">
          <button
            type="button"
            disabled={moreBusy}
            onClick={() => load({ reset: false, cursor: nextCursor })}
            className="rounded-full border border-zinc-200 px-4 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {moreBusy ? "Loading…" : "Load older messages"}
          </button>
        </div>
      )}
    </main>
  );
}
