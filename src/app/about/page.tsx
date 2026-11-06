"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  BatteryCharging,
  BatteryFull,
  BatteryMedium,
  CircuitBoard,
  Cpu,
  Laptop,
  MemoryStick,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { SYSTEM_STATS_SCHEMA, type SystemStats } from "@/lib/system-stats-schema";

/** Poll cadence: fast enough to feel live, slow enough not to thrash ps/proc. */
const POLL_MS = 1500;

function formatBytes(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${gib.toFixed(1)} GiB`;
  return `${Math.round(bytes / 1024 / 1024)} MiB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatGhz(mhz: number | null): string {
  return mhz ? `${(mhz / 1000).toFixed(2)} GHz` : "—";
}

/** Meter bar matching the timer's progress bar styling. */
function Meter({ pct, tone = "default" }: { pct: number; tone?: "default" | "good" }) {
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${
          tone === "good" ? "bg-emerald-500" : "bg-zinc-900 dark:bg-zinc-100"
        }`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#1d1f1e]"
    >
      <header className="flex items-center gap-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
        <Icon aria-hidden className="h-4 w-4" />
        {label}
      </header>
      {children}
    </section>
  );
}

function SpecRow({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="text-zinc-500 dark:text-zinc-400">{term}</dt>
      <dd className="truncate font-mono text-zinc-800 dark:text-zinc-200">{value}</dd>
    </div>
  );
}

/**
 * "About" — a live look at the machine Secptile runs on. The browser has no
 * route to the host, so everything comes from /api/system (server reads
 * /proc, /sys and ps). Polling keeps CPU/RAM/battery in real time; a stale
 * fetch never blanks the page, previous readings stay until the next one.
 */
export default function AboutPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [polling, setPolling] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch("/api/system", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // The endpoint validates with the same schema — double gate.
        setStats(SYSTEM_STATS_SCHEMA.parse(await response.json()));
        if (!cancelled) setError(null);
      } catch {
        if (!cancelled) setError("Lost touch with the machine — retrying…");
      }
    };

    void poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [polling]);

  if (!stats) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-3 px-6 py-10 font-sans">
        <RefreshCw aria-hidden className="h-5 w-5 animate-spin text-zinc-400" />
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Reading the machine…</p>
      </main>
    );
  }

  const ramPct = stats.ram.totalBytes > 0 ? (stats.ram.usedBytes * 100) / stats.ram.totalBytes : 0;
  const swapPct =
    stats.ram.swapTotalBytes > 0
      ? (stats.ram.swapUsedBytes * 100) / stats.ram.swapTotalBytes
      : 0;

  const BatteryIcon = stats.battery.charging
    ? BatteryCharging
    : (stats.battery.capacityPct ?? 100) >= 95
      ? BatteryFull
      : BatteryMedium;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10 font-sans">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          About
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          All of {stats.host.device ?? "your machine"}'s bits, live: CPU, GPU, memory,
          battery and which apps are drinking the RAM right now.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {error}
        </p>
      )}

      {/* The vitals, one strip: identity of the box itself. */}
      <StatCard icon={Laptop} label="This machine">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <SpecRow term="Host name" value={stats.host.hostname} />
          <SpecRow term="Device" value={stats.host.device ?? "—"} />
          <SpecRow term="OS" value={stats.host.os} />
          <SpecRow term="Kernel" value={stats.host.kernel} />
          <SpecRow term="Uptime" value={formatUptime(stats.host.uptimeSec)} />
          <SpecRow term="Battery" value={stats.battery.present ? `${stats.battery.capacityPct ?? "—"}%` : "None"} />
        </dl>
        <div className="flex items-center justify-end gap-2 text-xs text-zinc-400 dark:text-zinc-500">
          <button
            type="button"
            onClick={() => setPolling((value) => !value)}
            aria-pressed={polling}
            className="flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1 font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <RefreshCw aria-hidden className={`h-3 w-3 ${polling ? "animate-spin" : ""}`} />
            {polling ? "Live" : "Paused"}
          </button>
        </div>
      </StatCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <StatCard icon={Cpu} label="CPU">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{stats.cpu.model}</p>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-4xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
              {stats.cpu.usagePct.toFixed(0)}%
            </span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              across {stats.cpu.logicalCores} threads · {formatGhz(stats.cpu.mhz)}
            </span>
          </div>
          <Meter pct={stats.cpu.usagePct} />
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {stats.cpu.perCorePct.map((pct, index) => (
              <div key={index} className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                  {pct.toFixed(0)}
                </span>
                <div className="flex h-14 w-full items-end overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className="w-full rounded bg-zinc-900 transition-[height] duration-300 dark:bg-zinc-100"
                    style={{ height: `${Math.max(4, pct)}%`, alignSelf: "flex-end" }}
                  />
                </div>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500">C{index}</span>
              </div>
            ))}
          </div>
        </StatCard>

        <StatCard icon={CircuitBoard} label="GPU">
          {stats.gpu.name ? (
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{stats.gpu.name}</p>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Detecting…</p>
          )}
          {stats.gpu.usagePct !== null ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-4xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {stats.gpu.usagePct.toFixed(0)}%
                </span>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">in use</span>
              </div>
              <Meter pct={stats.gpu.usagePct} />
            </>
          ) : stats.gpu.currentMhz !== null ? (
            // Integrated Intel GPUs expose core clocks, not a busy counter.
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-4xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {formatGhz(stats.gpu.currentMhz)}
                </span>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  of {formatGhz(stats.gpu.maxMhz)} max
                </span>
              </div>
              <Meter pct={((stats.gpu.currentMhz ?? 0) / (stats.gpu.maxMhz || 1)) * 100} />
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                Busier moments push the clock toward its max.
              </p>
            </>
          ) : (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">No usage meter available.</p>
          )}
        </StatCard>

        <StatCard icon={MemoryStick} label="Memory">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-4xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
              {formatBytes(stats.ram.usedBytes)}
            </span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              of {formatBytes(stats.ram.totalBytes)}
            </span>
          </div>
          <Meter pct={ramPct} />
          {stats.ram.swapTotalBytes > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>Swap</span>
                <span className="font-mono tabular-nums">
                  {formatBytes(stats.ram.swapUsedBytes)} / {formatBytes(stats.ram.swapTotalBytes)}
                </span>
              </div>
              <Meter pct={swapPct} />
            </div>
          )}

          {/* The drinker list: RSS summed per application, biggest first. */}
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            <Activity aria-hidden className="h-3 w-3" />
            Top memory drinkers
          </p>
          <ul className="flex flex-col gap-2" aria-label="Applications using the most RAM">
            {stats.ram.topApps.map((app) => (
              <li key={app.name} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium text-zinc-800 dark:text-zinc-200" title={app.name}>
                    {app.name}
                    {app.processes > 1 && (
                      <span className="ml-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                        ×{app.processes}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    {formatBytes(app.rssBytes)} · {app.sharePct.toFixed(0)}%
                  </span>
                </div>
                <Meter pct={app.sharePct} />
              </li>
            ))}
            {stats.ram.topApps.length === 0 && (
              <li className="text-xs text-zinc-400 dark:text-zinc-500">No readings yet.</li>
            )}
          </ul>
        </StatCard>

        <StatCard icon={BatteryIcon} label="Battery">
          {stats.battery.present ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-4xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {stats.battery.capacityPct ?? "—"}%
                </span>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {stats.battery.charging
                    ? "charging"
                    : (stats.battery.capacityPct ?? 0) >= 99
                      ? "full (plugged in)"
                      : "on battery"}
                </span>
              </div>
              <Meter pct={stats.battery.capacityPct ?? 0} tone="good" />
              <dl className="grid grid-cols-1 gap-y-2">
                <SpecRow
                  term="Health"
                  value={stats.battery.healthPct !== null ? `${stats.battery.healthPct.toFixed(0)}% of design capacity` : "—"}
                />
                <SpecRow
                  term="Charge cycles"
                  value={stats.battery.cycleCount !== null ? String(stats.battery.cycleCount) : "—"}
                />
              </dl>
            </>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No battery detected — desktop rig.</p>
          )}
        </StatCard>
      </div>
    </main>
  );
}
