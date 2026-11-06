"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { formatUtcOffset, formatWallClock } from "./format-time";

/**
 * Local wall clock — the time in the user's current area (the browser's
 * timezone, from Intl). Seconds tick once per second. SSR-safe: the display
 * stays at a placeholder until mounted (same pattern as the navbar's
 * pathname), so server and client HTML never disagree.
 */
export function LocalClock() {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setMounted(true);
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const display = mounted ? formatWallClock(now) : "--:--:--";

  return (
    <section
      aria-label="Local clock"
      className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#1d1f1e]"
    >
      <header className="flex items-center gap-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
        <Clock aria-hidden className="h-4 w-4" />
        Time in your area
      </header>

      <p
        className="font-mono text-6xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50"
        role="timer"
        aria-live="off"
      >
        {display}
      </p>

      {mounted && (
        <>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {now.toLocaleDateString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-zinc-200 pt-4 text-sm sm:grid-cols-3 dark:border-zinc-800">
            <dt className="text-zinc-500 dark:text-zinc-400">Time zone</dt>
            <dd className="col-span-2 truncate font-mono text-zinc-800 dark:text-zinc-200">
              {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">UTC offset</dt>
            <dd className="col-span-2 font-mono text-zinc-800 dark:text-zinc-200">
              {formatUtcOffset(now)}
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">Zone short name</dt>
            <dd className="col-span-2 font-mono text-zinc-800 dark:text-zinc-200">
              {Intl.DateTimeFormat(undefined, {
                timeZoneName: "short",
              })
                .formatToParts(now)
                .find((part) => part.type === "timeZoneName")?.value ?? "—"}
            </dd>
          </dl>
        </>
      ) : (
        <p className="text-sm text-zinc-400 dark:text-zinc-600">
          Reading your system clock…
        </p>
      )}
    </section>
  );
}
