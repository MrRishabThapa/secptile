"use client";

import type { RecorderState } from "./use-voice-recorder";

type Props = {
  state: RecorderState;
  elapsed: number;
  onToggle: () => void;
  disabled?: boolean;
};

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const LABELS: Record<RecorderState, string> = {
  idle: "Talk",
  recording: "Stop",
  transcribing: "Listening back…",
};

export function MicButton({ state, elapsed, onToggle, disabled }: Props) {
  const recording = state === "recording";
  const busy = state !== "idle";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled || state === "transcribing"}
        aria-pressed={recording}
        aria-label={LABELS[state]}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
          recording
            ? "border-red-400 bg-red-600 text-white hover:bg-red-500 dark:border-red-600 dark:bg-red-700"
            : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
      >
        <span
          aria-hidden
          className={`inline-block h-2 w-2 rounded-full ${recording ? "animate-pulse bg-white" : busy ? "animate-pulse bg-zinc-500" : "bg-red-500"}`}
        />
        {state === "transcribing" ? "Transcribing…" : LABELS[state]}
        {recording && <span className="tabular-nums opacity-80">{formatElapsed(elapsed)}</span>}
      </button>
      <span className="text-xs text-zinc-400 dark:text-zinc-600">
        {recording ? "recording — press again to stop" : "or talk instead of typing"}
      </span>
    </div>
  );
}
