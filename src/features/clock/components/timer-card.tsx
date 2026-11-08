"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Hourglass, Minus, Pause, Play, Plus, RotateCcw } from "lucide-react";
import { formatDuration } from "../utils/format-time";

const MIN_MINUTES = 1;
const MAX_MINUTES = 180;
/** Quick presets (minutes) — 25/50 slot in with the pomodoro-style workflow. */
const PRESETS = [1, 3, 5, 10, 15, 25, 30, 50];

/** Gently beep three times when the timer finishes (no-op if audio is blocked). */
function beepFinished() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const t0 = ctx.currentTime;
    for (let n = 0; n < 3; n++) {
      const tone = ctx.createOscillator();
      const gain = ctx.createGain();
      tone.connect(gain);
      gain.connect(ctx.destination);
      tone.frequency.value = 880;
      tone.type = "sine";
      const start = t0 + n * 0.45;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
      gain.gain.linearRampToValueAtTime(0, start + 0.3);
      tone.start(start);
      tone.stop(start + 0.32);
    }
    void ctx.close();
  } catch {
    // Audio is a nicety, never a requirement.
  }
}

/**
 * Countdown timer. Accuracy is timestamp-based: while running we hold an
 * `endAt` deadline and derive the remaining time from `Date.now()`, so the
 * countdown does not drift from throttled interval callbacks. Pauses just
 * capture the remainder and re-arm a fresh deadline on resume.
 */
export function TimerCard() {
  const [durationMs, setDurationMs] = useState(5 * 60_000);
  const [remainingMs, setRemainingMs] = useState(() => 5 * 60_000);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const endAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (endAtRef.current === null) return;
      const remaining = endAtRef.current - Date.now();
      if (remaining <= 0) {
        endAtRef.current = null;
        setRunning(false);
        setRemainingMs(0);
        setDone(true);
        beepFinished();
      } else {
        setRemainingMs(remaining);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [running]);

  /** Set an explicit duration (minutes) while idle or paused. */
  const setMinutes = useCallback((minutes: number) => {
    const clamped = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, minutes));
    const ms = clamped * 60_000;
    setRunning(false);
    setDone(false);
    endAtRef.current = null;
    setDurationMs(ms);
    setRemainingMs(ms);
  }, []);

  const start = useCallback(() => {
    setDone(false);
    setRunning(true);
    endAtRef.current = Date.now() + remainingMs;
  }, [remainingMs]);

  const pause = useCallback(() => {
    if (endAtRef.current === null) return;
    setRemainingMs(Math.max(0, endAtRef.current - Date.now()));
    endAtRef.current = null;
    setRunning(false);
  }, []);

  const reset = useCallback(() => {
    setRunning(false);
    setDone(false);
    endAtRef.current = null;
    setRemainingMs(durationMs);
  }, [durationMs]);

  const total = Math.max(1, durationMs);
  const progress = done ? 1 : Math.min(1, Math.max(0, (total - remainingMs) / total));

  return (
    <section
      aria-label="Timer"
      className="flex flex-col gap-5 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#1d1f1e]"
    >
      <header className="flex items-center gap-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
        <Hourglass aria-hidden className="h-4 w-4" />
        Timer
      </header>

      <p
        className={`text-center font-mono text-6xl font-semibold tabular-nums tracking-tight ${
          done
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-zinc-900 dark:text-zinc-50"
        }`}
        role="timer"
        aria-live={done ? "assertive" : "off"}
      >
        {done ? "Time's up" : formatDuration(remainingMs)}
      </p>

      {/* Progress bar: full-width ring substitute, kept deliberately quiet. */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        role="progressbar"
        aria-label="Timer progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${
            done
              ? "bg-emerald-500"
              : "bg-zinc-900 dark:bg-zinc-100"
          }`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Presets + duration nudge, editable only while a run is paused/idle. */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={running}
            onClick={() => setMinutes(preset)}
            aria-pressed={durationMs === preset * 60_000}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              durationMs === preset * 60_000
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {preset} min
          </button>
        ))}
        <div className="ml-1 flex items-center gap-1">
          <button
            type="button"
            disabled={running}
            aria-label="Remove one minute"
            onClick={() => setMinutes(Math.round(durationMs / 60_000) - 1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300 text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Minus aria-hidden className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={running}
            aria-label="Add one minute"
            onClick={() => setMinutes(Math.round(durationMs / 60_000) + 1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300 text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Plus aria-hidden className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {running ? (
          <button
            type="button"
            onClick={pause}
            className="flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <Pause aria-hidden className="h-4 w-4" />
            Pause
          </button>
        ) : (
          <button
            type="button"
            disabled={done || remainingMs === 0}
            onClick={start}
            className="flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <Play aria-hidden className="h-4 w-4" />
            {remainingMs < durationMs ? "Resume" : "Start"}
          </button>
        )}
        <button
          type="button"
          onClick={reset}
          disabled={!running && !done && remainingMs === durationMs}
          className="flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <RotateCcw aria-hidden className="h-4 w-4" />
          Reset
        </button>
      </div>
    </section>
  );
}
