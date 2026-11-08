"use client";

import { useState } from "react";
import { LocalClock } from "@/features/clock/components/local-clock";
import { TimerCard } from "@/features/clock/components/timer-card";
import { StopwatchCard } from "@/features/clock/components/stopwatch-card";

type ClockTab = "clock" | "timer" | "stopwatch";

const TABS: { id: ClockTab; label: string }[] = [
  { id: "clock", label: "Clock" },
  { id: "timer", label: "Timer" },
  { id: "stopwatch", label: "Stopwatch" },
];

/**
 * The Clock surface: local wall clock, countdown timer, and stopwatch.
 * Tabs are styled like the navbar pills; hidden tabs stay mounted (state
 * preserved) so a running timer or stopwatch keeps going when you glance
 * elsewhere on this page.
 */
export default function ClockPage() {
  const [tab, setTab] = useState<ClockTab>("clock");

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10 font-sans">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Clock
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            The time where you are, plus a timer and a stopwatch for working
            sessions. Switching tabs never stops a running countdown.
          </p>
        </div>

        <nav aria-label="Clock tools" className="flex items-center gap-1">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              aria-current={tab === entry.id ? "true" : undefined}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === entry.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </div>

      <div className={tab === "clock" ? "mx-auto w-full max-w-lg" : "hidden"}>
        <LocalClock />
      </div>
      <div className={tab === "timer" ? "mx-auto w-full max-w-lg" : "hidden"}>
        <TimerCard />
      </div>
      <div className={tab === "stopwatch" ? "mx-auto w-full max-w-lg" : "hidden"}>
        <StopwatchCard />
      </div>
    </main>
  );
}
