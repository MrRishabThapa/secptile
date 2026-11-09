"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Volume2 } from "lucide-react";

type Status = { state: string; detail: string } | null;
type Pending = { id: string; text: string } | null;

type Payload = { status: Status; pending: Pending };
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
  listening: "Listening for “hey secp”",
  conversing: "Your turn — go ahead",
  speaking: "Speaking — talk to interrupt",
  transcribing: "Transcribing…",
  sent: "Sent to the journal",
  error: "Assistant error",
  muted: "Muted — mic stream closed",
  stopped: "Stopped",
};

function StateIcon({ state }: { state: string }) {
  const className = `h-3.5 w-3.5 shrink-0 ${stateText(state)}`;
  if (state === "speaking") return <Volume2 aria-hidden className={className} />;
  if (state === "muted" || state === "stopped") return <MicOff aria-hidden className={className} />;
  return <Mic aria-hidden className={className} />;
}

function stateText(state: string): string {
  switch (state) {
    case "transcribing":
    case "speaking":
      return "text-sky-700 dark:text-sky-400";
    case "error":
    case "stopped":
      return "text-amber-700 dark:text-amber-400";
    case "muted":
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
 * Voice-assistant status bar (Phase 6): live mic state from the daemon, and
 * the handover of spoken turns into the journal whenever the page is ready.
 * Renders nothing until the daemon first reports in.
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

  if (!status) return null; // daemon never ran — don't add UI noise

  return (
    <div
      role="status"
      className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900"
      title={status.detail || undefined}
    >
      <span
        aria-hidden
        className={`h-2 w-2 shrink-0 rounded-full ${dotClass(status.state)}`}
      />
      <StateIcon state={status.state} />
      <span className={`font-medium ${stateText(status.state)}`}>
        {STATE_LABEL[status.state] ?? status.state}
      </span>
      {status.detail && (
        <span className="truncate text-zinc-500 dark:text-zinc-400">
          {status.detail}
        </span>
      )}
      {pendingWaiting && (
        <span className="shrink-0 text-amber-700 dark:text-amber-400">
          — your spoken reply is next in line
        </span>
      )}
    </div>
  );
}
