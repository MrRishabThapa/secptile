"use client";

import { useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";

type Status = { state: string; detail: string } | null;
type Pending = { id: string; text: string } | null;
type Effort = "medium" | "high";

type Payload = { status: Status; pending: Pending; effort?: Effort; effortSupported?: boolean };
type Props = {
  /**
   * Called for each fresh assistant transcript. The page only wires this when
   * it is ready for a spoken turn, not while a journal request is running. A
   * transcript can never publish anything: approval stays a click in the UI.
   */
  onTranscript?: (text: string) => void;
};

const SEEN_KEY = "secptile:assistant:seen";
const POLL_MS = 600; // spoken turns should feel immediate
const STATE_LABEL: Record<string, string> = {
  listening: "Say “secptile” to start",
  sleeping: "Asleep — say “secptile” to wake",
  conversing: "Awake — go ahead, “kudos” to stop",
  speaking: "Speaking — talk to interrupt",
  transcribing: "Transcribing…",
  sent: "Sent to the journal",
  error: "Assistant error",
  muted: "Muted — mic stream closed",
  stopped: "Stopped",
};

function stateText(state: string): string {
  switch (state) {
    case "transcribing":
    case "speaking":
      return "text-sky-700 dark:text-sky-400";
    case "error":
    case "stopped":
      return "text-amber-700 dark:text-amber-400";
    case "muted":
    case "sleeping":
      return "text-zinc-500 dark:text-zinc-400";
    default:
      return "text-emerald-700 dark:text-emerald-400";
  }
}

function dotClass(state: string): string {
  if (state === "transcribing" || state === "speaking") return "bg-sky-500 animate-pulse";
  if (state === "listening" || state === "conversing") return "bg-emerald-500 animate-pulse";
  return "bg-zinc-400"; // muted / stopped / error / sent → no active mic
}

/**
 * Voice-assistant status line (Phase 6) for the chat header: live mic state
 * from the daemon, and the handover of spoken turns into the journal whenever
 * the page is ready. Before the daemon reports in, it says the page is ready.
 */
export function AssistantBar({ onTranscript }: Props) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [pendingWaiting, setPendingWaiting] = useState(false);
  const seen = useRef<string | null>(null); // last transcript the page consumed
  const latestOnTranscript = useRef(onTranscript);

  useEffect(() => {
    latestOnTranscript.current = onTranscript;
  });

  useEffect(() => {
    let cancelled = false;
    let backlog = 0; // pending fetch slots — never pile up
    let timer: number | undefined;

    /** Runs on every poll, so a busy page picks the turn up once it is free. */
    function consume(pending: Pending) {
      if (seen.current === null) {
        try {
          seen.current = window.localStorage.getItem(SEEN_KEY) ?? "";
        } catch {
          seen.current = ""; // private mode — refs are enough for one session
        }
      }
      if (!pending || pending.id === seen.current) {
        setPendingWaiting(false);
        return;
      }
      const deliver = latestOnTranscript.current;
      if (!deliver) {
        setPendingWaiting(true);
        return;
      }
      seen.current = pending.id;
      try {
        window.localStorage.setItem(SEEN_KEY, pending.id);
      } catch {
        /* nothing to keep private — id only */
      }
      setPendingWaiting(false);
      deliver(pending.text);
    }

    async function poll() {
      if (backlog > 0) return;
      backlog += 1;
      try {
        const response = await fetch("/api/assistant/status", { cache: "no-store" });
        if (!cancelled && response.ok) {
          const next = (await response.json()) as Payload;
          setPayload(next);
          consume(next.pending);
        }
      } catch {
        // daemon or app offline — the bar simply stays absent
      } finally {
        backlog -= 1;
        if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const status = payload?.status ?? null;
  const effort = payload?.effort ?? "medium";
  const supported = payload?.effortSupported ?? true;
  const high = effort === "high";

  async function toggleEffort() {
    const next: Effort = high ? "medium" : "high";
    setPayload((current) => (current ? { ...current, effort: next } : current));
    await fetch("/api/assistant/effort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effort: next }),
    }).catch(() => undefined); // the next poll restores the real state
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {status ? (
        <p
          role="status"
          className="flex min-w-0 items-center gap-1.5 text-xs"
          title={status.detail || undefined}
        >
          <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(status.state)}`} />
          <span className={`shrink-0 ${stateText(status.state)}`}>
            {STATE_LABEL[status.state] ?? status.state}
          </span>
          {status.detail && (
            <span className="truncate text-zinc-500 dark:text-zinc-400">{status.detail}</span>
          )}
          {pendingWaiting && (
            <span className="truncate text-amber-700 dark:text-amber-400">your spoken reply is next in line</span>
          )}
        </p>
      ) : (
        <p role="status" className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
          Ready
        </p>
      )}
      <button
        type="button"
        onClick={() => void toggleEffort()}
        aria-pressed={high}
        title={
          !supported
            ? "The current model has no effort levels, so this has no effect. Change OPENCODE_MODEL."
            : high
              ? "High mode is on. Click, or say “kudos”, to go back to medium."
              : "Medium mode. Click, or say “mega evolve”, for high mode."
        }
        className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          !supported
            ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            : high
              ? "bg-indigo-600 text-white"
              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        }`}
      >
        <Zap aria-hidden className={`h-3 w-3 ${high ? "fill-current" : ""}`} />
        {!supported ? "No effort levels" : high ? "Mega evolved" : "Medium"}
      </button>
    </div>
  );
}
