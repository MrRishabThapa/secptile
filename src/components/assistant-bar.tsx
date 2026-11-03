"use client";

import { useEffect, useRef, useState } from "react";

type Status = { state: string; detail: string } | null;
type Pending = { id: string; text: string } | null;

type Payload = { status: Status; pending: Pending };
type Props = {
  /**
   * Called for each fresh assistant transcript. The page only wires this when
   * it can safely inject — i.e. on the idle input step — so the assistant can
   * never hijack an ongoing journal session or a publish flow.
   */
  onTranscript?: (text: string) => void;
};

const SEEN_KEY = "secptile:assistant:seen";
const POLL_MS = 1500; // personal tool — a light interval is fine
const STATE_LABEL: Record<string, string> = {
  listening: "Listening",
  transcribing: "Transcribing…",
  sent: "Sent to the journal",
  error: "Assistant error",
  muted: "Muted — mic stream closed",
  stopped: "Stopped",
};

function stateText(state: string): string {
  switch (state) {
    case "transcribing":
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
  if (state === "transcribing") return "bg-sky-500 animate-pulse";
  if (state === "listening") return "bg-emerald-500 animate-pulse";
  return "bg-zinc-400"; // muted / stopped / error / sent → no active mic
}

/**
 * Voice-assistant status bar (Phase 6): live mic state from the daemon and an
 * idle-only handover of spoken transcripts into the journal. Renders nothing
 * until the daemon first reports in.
 */
export function AssistantBar({ onTranscript }: Props) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const seen = useRef<string | null>(null); // last transcript the page consumed

  useEffect(() => {
    let cancelled = false;
    let backlog = 0; // pending fetch slots — never pile up
    let timer: number | undefined;

    async function poll() {
      if (backlog > 0) return;
      backlog += 1;
      try {
        const response = await fetch("/api/assistant/status", { cache: "no-store" });
        if (!cancelled && response.ok) {
          setPayload((await response.json()) as Payload);
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

  useEffect(() => {
    const pending = payload?.pending;
    if (!pending) return;
    if (seen.current === null) {
      try {
        seen.current = window.localStorage.getItem(SEEN_KEY) ?? "";
      } catch {
        seen.current = ""; // private mode — refs are enough for one session
      }
    }
    if (pending.id === seen.current) return;
    if (!onTranscript) return; // page busy — leave pending for the next idle render
    seen.current = pending.id;
    try {
      window.localStorage.setItem(SEEN_KEY, pending.id);
    } catch {
      /* nothing to keep private — id only */
    }
    onTranscript(pending.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload?.pending?.id]);

  const status = payload?.status ?? null;
  const pendingWaiting = Boolean(payload?.pending) && !onTranscript;

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
      <span className={`font-medium ${stateText(status.state)}`}>
        Voice assistant: {STATE_LABEL[status.state] ?? status.state}
      </span>
      {status.detail && (
        <span className="truncate text-zinc-500 dark:text-zinc-400">
          {status.detail}
        </span>
      )}
      {pendingWaiting && (
        <span className="shrink-0 text-amber-700 dark:text-amber-400">
          — a spoken update is waiting; finish the current session first
        </span>
      )}
    </div>
  );
}
