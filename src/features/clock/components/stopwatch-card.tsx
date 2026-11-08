"use client";

import { useCallback, useEffect, useState } from "react";
import { Flag, Pause, Play, RotateCcw } from "lucide-react";
import { formatStopwatch, pad2 } from "../utils/format-time";

/**
 * Stopwatch with laps. Timestamp-based like the timer: `startAt` anchors the
 * absolute start, `baseMs` carries over accumulated time through pauses.
 * Readings tick at 50ms — fast enough for visible centiseconds, slow enough
 * not to fight the framework.
 */
export function StopwatchCard() {
  const [baseMs, setBaseMs] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [running, setRunning] = useState(false);
  const [laps, setLaps] = useState<number[]>([]);
  const [startAt, setStartAt] = useState<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (startAt === null) return;
      setElapsedMs(baseMs + (Date.now() - startAt));
    }, 50);
    return () => window.clearInterval(id);
  }, [running, startAt, baseMs]);

  const start = useCallback(() => {
    setStartAt(Date.now());
    setRunning(true);
  }, []);

  const stop = useCallback(() => {
    if (startAt === null) return;
    const total = baseMs + (Date.now() - startAt);
    setElapsedMs(total);
    setBaseMs(total);
    setStartAt(null);
    setRunning(false);
  }, [baseMs, startAt]);

  const reset = useCallback(() => {
    setRunning(false);
    setStartAt(null);
    setBaseMs(0);
    setElapsedMs(0);
    setLaps([]);
  }, []);

  const recordLap = useCallback(() => {
    if (!running && elapsedMs === 0) return;
    const total = running && startAt !== null ? baseMs + (Date.now() - startAt) : elapsedMs;
    setLaps((list) => [total, ...list]); // laps: cumulative; lap time = cum - prior
  }, [running, startAt, baseMs, elapsedMs]);

  return (
    <section
      aria-label="Stopwatch"
      className="flex flex-col gap-5 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#1d1f1e]"
    >
      <header className="flex items-center gap-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
        <Flag aria-hidden className="h-4 w-4" />
        Stopwatch
      </header>

      <p
        className="text-center font-mono text-6xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50"
        role="timer"
        aria-live="off"
      >
        {formatStopwatch(elapsedMs)}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {running ? (
          <button
            type="button"
            onClick={stop}
            className="flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <Pause aria-hidden className="h-4 w-4" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            className="flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <Play aria-hidden className="h-4 w-4" />
            {elapsedMs > 0 ? "Resume" : "Start"}
          </button>
        )}
        <button
          type="button"
          disabled={!running}
          onClick={recordLap}
          className="flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Flag aria-hidden className="h-4 w-4" />
          Lap
        </button>
        <button
          type="button"
          disabled={!running && elapsedMs === 0 && laps.length === 0}
          onClick={reset}
          className="flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <RotateCcw aria-hidden className="h-4 w-4" />
          Reset
        </button>
      </div>

      {laps.length > 0 && (
        <ol
          className="max-h-64 overflow-y-auto rounded-lg border border-zinc-200 text-sm dark:border-zinc-800"
          aria-label="Laps"
        >
          {laps.map((cumulative, index) => {
            const lapTime = cumulative - (laps[index + 1] ?? 0);
            return (
              <li
                key={laps.length - index}
                className="flex items-center justify-between gap-4 border-b border-zinc-200 px-4 py-2 last:border-b-0 dark:border-zinc-800"
              >
                <span className="text-zinc-500 dark:text-zinc-400">
                  Lap {pad2(laps.length - index)}
                </span>
                <span className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
                  {formatStopwatch(lapTime)}
                </span>
                <span className="font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                  {formatStopwatch(cumulative)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
