import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { SYSTEM_STATS_SCHEMA, type SystemStats } from "./system-stats-schema";

const execFileAsync = promisify(execFile);

/**
 * Live machine stats for the About surface. Everything is read straight from
 * the kernel interfaces on this Linux box (/proc, /sys) or from a single
 * `ps` call — no monitoring dependencies, no browser access to the host.
 *
 * Contract (zod): lives in system-stats-schema.ts; the API route validates
 * every returned payload against SYSTEM_STATS_SCHEMA before sending it.
 */

export { SYSTEM_STATS_SCHEMA };
export type { SystemStats };

/** Per-CPU busy columns from /proc/stat (first line of a cpuN block). */
interface CpuSample {
  idle: number;
  total: number;
}

function parseCpuStat(raw: string): CpuSample[] {
  return raw
    .split("\n")
    .filter((line) => /^cpu\d+\s/.test(line))
    .map((line) => {
      const cols = line.trim().split(/\s+/).slice(1).map(Number);
      const idle = (cols[3] ?? 0) + (cols[4] ?? 0); // idle + iowait
      const total = cols.reduce((sum, value) => sum + value, 0);
      return { idle, total };
    });
}

/** How much of RAM actually counts as "used": everything not available. */
function parseMemInfo(raw: string): Record<string, number> {
  const info: Record<string, number> = {};
  for (const line of raw.split("\n")) {
    const [key, value] = line.split(":");
    if (key && value) info[key.trim()] = Number(value.trim().split(/\s+/)[0]) * 1024;
  }
  return info;
}

/** GPU model from lspci, cached — the hardware does not change between polls. */
let cachedGpuName: string | null = null;
let cachedGpuPath: string | null = null;

async function detectGpu(): Promise<void> {
  if (cachedGpuName !== null) return;
  try {
    // Plain lspci keeps readable names: "00:02.0 VGA compatible controller:
    // Intel Corporation TigerLake-LP GT2 [Iris Xe Graphics] (rev 01)".
    const { stdout } = await execFileAsync("lspci", []);
    const displayLine = stdout
      .split("\n")
      .find((line) => /vga|3d|display/i.test(line));
    // After the bus id "00:02.0" and the class, the readable name follows the
    // final colon — so take the last colon-delimited chunk.
    const match = displayLine?.match(/:\s*([^:]+)$/);
    if (match) {
      cachedGpuName =
        match[1]
          .trim()
          // Drop the trailing PCI-id bracket only if it is a hex bus id, not "[AMD]".
          .replace(/\s*\[[0-9a-fA-F]{4}:[0-9a-fA-F]{4}\]\s*$/, "")
          .replace(/\s*\(rev [0-9a-fA-F]+\)\s*$/i, "")
          .trim() || null;
    }
  } catch (error) {
    console.warn("[system-stats] lspci unavailable:", error);
  }
  // Find the DRM card device backing an Intel iGPU for live frequency reads.
  try {
    const entries = await fs.readdir("/sys/class/drm");
    const card = entries.filter((entry) => /^card\d+$/.test(entry))[0];
    if (card) {
      await fs.readFile(`/sys/class/drm/${card}/gt_cur_freq_mhz`, "utf8");
      cachedGpuPath = `/sys/class/drm/${card}`;
    }
  } catch {
    cachedGpuPath = null; // discrete GPU or non-i915 driver — no frequency data.
  }
}

/** util% + current/boost clock from nvidia-smi when a discrete card exists. */
async function readNvidiaGpu() {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", [
      "--query-gpu=name,utilization.gpu",
      "--format=csv,noheader,nounits",
    ]);
    const [name, utilization] = stdout.trim().split(",");
    return {
      name: name.trim(),
      usagePct: Number(utilization),
      currentMhz: null,
      maxMhz: null,
    };
  } catch {
    return null;
  }
}

/** Aggregated per-application memory from `ps`: RSS summed by command name. */
async function readTopApps(totalBytes: number) {
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("ps", ["-eo", "rss,comm", "--no-headers", "--sort=-rss"]));
  } catch (error) {
    console.warn("[system-stats] ps unavailable:", error);
    return [];
  }
  const byApp = new Map<string, { rssKb: number; processes: number }>();
  for (const line of stdout.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const rssKb = Number(parts[0]);
    const name = parts.slice(1).join(" ");
    if (!Number.isFinite(rssKb) || rssKb <= 0) continue;
    const entry = byApp.get(name) ?? { rssKb: 0, processes: 0 };
    entry.rssKb += rssKb;
    entry.processes += 1;
    byApp.set(name, entry);
  }
  return [...byApp.entries()]
    .map(([name, entry]) => ({
      name,
      processes: entry.processes,
      rssBytes: entry.rssKb * 1024,
      sharePct: totalBytes > 0 ? (entry.rssKb * 1024 * 100) / totalBytes : 0,
    }))
    .sort((a, b) => b.rssBytes - a.rssBytes)
    .slice(0, 8);
}

async function readBattery() {
  let dirNames: string[] = [];
  try {
    dirNames = (await fs.readdir("/sys/class/power_supply")).filter((d) => /^BAT/i.test(d));
  } catch {
    return { present: false, capacityPct: null, charging: null, healthPct: null, cycleCount: null };
  }
  if (dirNames.length === 0) {
    return { present: false, capacityPct: null, charging: null, healthPct: null, cycleCount: null };
  }
  const dir = `/sys/class/power_supply/${dirNames[0]}`;
  const read = async (file: string) => {
    try {
      return (await fs.readFile(`${dir}/${file}`, "utf8")).trim();
    } catch {
      return null;
    }
  };
  const capacity = Number(await read("capacity"));
  const status = await read("status");
  const chargeFull = Number(await read("charge_full")) || Number(await read("energy_full"));
  const chargeFullDesign =
    Number(await read("charge_full_design")) || Number(await read("energy_full_design"));
  const cycleCount = Number(await read("cycle_count"));
  return {
    present: true,
    capacityPct: Number.isFinite(capacity) ? capacity : null,
    charging: status === "Charging" || status === "Full" ? status === "Charging" : null,
    healthPct:
      Number.isFinite(chargeFull) && chargeFull > 0 && Number.isFinite(chargeFullDesign) && chargeFullDesign > 0
        ? Math.min(100, (chargeFull * 100) / chargeFullDesign)
        : null,
    cycleCount: Number.isFinite(cycleCount) ? cycleCount : null,
  };
}

/** Filesystem types backed by a real disk; network/overlay/loop mounts excluded. */
const KINDS = new Set([
  "ext4", "ext3", "ext2", "btrfs", "xfs", "f2fs", "jfs",
  "ntfs3", "ntfs", "vfat", "exfat", "zfs", "bcachefs",
]);

/**
 * One entry per physical volume that is actually mounted. Btrfs subvolume
 * mounts repeat the same device (/home, @/…), so the first mount wins and the
 * duplicates are dropped; the tiny ESP under /boot|/efi is skipped as noise.
 */
async function readStorage() {
  let raw = "";
  try {
    raw = await fs.readFile("/proc/self/mounts", "utf8");
  } catch (error) {
    console.warn("[system-stats] /proc/self/mounts unavailable:", error);
    return { disks: [] };
  }
  const seen = new Set<string>();
  const disks: { name: string; mount: string; totalBytes: number; usedBytes: number }[] = [];
  for (const line of raw.split("\n")) {
    const [device, mount, kind] = line.trim().split(/\s+/);
    if (!device?.startsWith("/dev/") || !KINDS.has(kind ?? "")) continue;
    if (/^\/(boot|efi)/.test(mount ?? "")) continue;
    const name = device.replace(/^\/dev\//, "");
    if (seen.has(name)) continue;
    seen.add(name);
    try {
      const st = await fs.statfs(mount);
      const totalBytes = Number(st.blocks) * st.bsize;
      if (totalBytes <= 0) continue;
      disks.push({
        name,
        mount,
        totalBytes,
        usedBytes: Math.max(0, totalBytes - Number(st.bfree) * st.bsize),
      });
    } catch {
      // Dismounted or unreadable mid-scan — leave this volume out.
    }
  }
  disks.sort((a, b) => b.totalBytes - a.totalBytes);
  return { disks };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * CPU usage is a rate, so we need two samples: read /proc/stat, wait a short
 * window, read again, and derive per-core percentages from the deltas.
 */
async function readCpu() {
  const [first, second] = await Promise.all([
    fs.readFile("/proc/stat", "utf8"),
    fs.readFile("/proc/cpuinfo", "utf8").then((m) => ({
      model: m.match(/model name\s*:\s*(.+)/)?.[1]?.trim() ?? "Unknown CPU",
      mhz: Number(m.match(/cpu MHz\s*:\s*([0-9.]+)/)?.[1] ?? 0) || 0,
    })),
    sleep(200),
  ]);
  const prev = parseCpuStat(first);
  const now = parseCpuStat(await fs.readFile("/proc/stat", "utf8"));
  const perCorePct = now.map((core, index) => {
    const before = prev[index];
    if (!before || core.total <= before.total) return 0;
    return Math.min(100, ((core.total - core.idle - (before.total - before.idle)) * 100) / (core.total - before.total));
  });
  const usagePct = perCorePct.length ? perCorePct.reduce((a, b) => a + b, 0) / perCorePct.length : 0;
  return { model: second.model, mhz: second.mhz, logicalCores: perCorePct.length, usagePct, perCorePct };
}

async function readGpu() {
  await detectGpu();
  const nvidia = await readNvidiaGpu();
  if (nvidia) return nvidia;
  let currentMhz: number | null = null;
  let maxMhz: number | null = null;
  if (cachedGpuPath) {
    try {
      const [cur, max] = await Promise.all([
        fs.readFile(`${cachedGpuPath}/gt_cur_freq_mhz`, "utf8"),
        fs.readFile(`${cachedGpuPath}/gt_max_freq_mhz`, "utf8"),
      ]);
      currentMhz = Number(cur.trim()) || null;
      maxMhz = Number(max.trim()) || null;
    } catch {
      // Frequency controls vanish on some drivers; fall back to model only.
    }
  }
  return { name: cachedGpuName, usagePct: null, currentMhz, maxMhz };
}

/** One snapshot of everything the About page renders. */
export async function readSystemStats(): Promise<SystemStats> {
  const [cpu, gpu, memRaw, uptimeRaw, battery, osRelease, device, hostname, storage] =
    await Promise.all([
      readCpu(),
      readGpu(),
      fs.readFile("/proc/meminfo", "utf8"),
      fs.readFile("/proc/uptime", "utf8"),
      readBattery(),
      fs.readFile("/etc/os-release", "utf8").catch(() => ""),
      fs
        .readFile("/sys/class/dmi/id/product_name", "utf8")
        .then((v) => v.trim())
        .catch(() => null),
      Promise.resolve(os.hostname()),
      readStorage(),
    ]);

  const mem = parseMemInfo(memRaw);
  const totalBytes = mem.MemTotal ?? 0;
  const swapTotalBytes = mem.SwapTotal ?? 0;
  const topApps = await readTopApps(totalBytes);

  return {
    host: {
      hostname,
      device,
      os: osRelease.match(/PRETTY_NAME="?([^"\n]+)"?/)?.[1] ?? "Linux",
      kernel: os.release(),
      uptimeSec: Math.floor(Number(uptimeRaw.split(/\s+/)[0]) || 0),
    },
    cpu,
    gpu,
    ram: {
      totalBytes,
      usedBytes: Math.max(0, totalBytes - (mem.MemAvailable ?? 0)),
      swapTotalBytes,
      swapUsedBytes: Math.max(0, swapTotalBytes - (mem.SwapFree ?? 0)),
      topApps,
    },
    battery,
    storage,
  };
}
