import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { PENDING_UPDATES_SCHEMA, UPDATE_THREAD_SCHEMA, type PendingUpdates, type UpdateThread } from "./updates-schema";

const execFileAsync = promisify(execFile);

/**
 * Pending pacman (Omarchy/Arch) updates for the Updates surface, read with
 * local tools only — `checkupdates` for the list, `pacman -Si/-Qi` for each
 * package's thread of details. Nothing syncs, installs or modifies the
 * system; this is a read-only mirror of what `checkupdates` would show.
 *
 * Contracts (zod) live in updates-schema.ts; API routes validate every
 * payload against them before sending.
 */

export { PENDING_UPDATES_SCHEMA };
export type { PendingUpdates };

class UpdateNotFound extends Error {
  constructor(name: string) {
    super(`No pending update for ${name}`);
    this.name = "UpdateNotFound";
  }
}

export { UpdateNotFound };

async function readCheckUpdates(): Promise<string> {
  // checkupdates copies the sync db to a temp dir, so it never touches the
  // real system and works without root. First run can take a few seconds.
  const { stdout } = await execFileAsync("checkupdates", []);
  return stdout;
}

/** `checkupdates` lines look like: "name 1.2.3-1 -> 2.0.0-1". */
export async function readPendingUpdates(): Promise<PendingUpdates> {
  const raw = await readCheckUpdates().catch((error: { message?: string }) => {
    // "No updates available" is a normal outcome, not a failure.
    if (/no updates/i.test(error.message ?? "")) return "";
    throw error;
  });
  const updates = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [names, from, arrow, to] = line.trim().split(/\s+/);
      return { name: names ?? "", currentVersion: from ?? "", newVersion: arrow === "->" ? (to ?? "") : (arrow ?? "") };
    })
    .filter((u) => u.name && u.newVersion);
  return PENDING_UPDATES_SCHEMA.parse({
    hostname: os.hostname(),
    checkedAt: new Date().toISOString(),
    updates,
  });
}

/** "12.35 MiB" / "1 024.00 B" from pacman → bytes. */
function sizeToBytes(size: string): number | null {
  const match = size.match(/^([\d\s.,]+)\s*(B|KiB|MiB|GiB|TiB)$/);
  if (!match) return null;
  const value = Number(match[1].replace(/[\s,]/g, ""));
  if (!Number.isFinite(value)) return null;
  const unit = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 }[match[2]] ?? 1;
  return Math.round(value * unit);
}

function parsePacmanFields(stdout: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const sep = line.indexOf(" : ");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    if (!key || fields[key]) continue;
    fields[key] = line.slice(sep + 3).trim();
  }
  return fields;
}

function splitList(value: string | undefined): string[] {
  return value && value !== "None" ? value.split(/\s{2,}/).filter(Boolean) : [];
}

/**
 * One package's update thread: the local facts about what this update is
 * (from the repo sync db and the installed-package db) — description,
 * dependencies, provides, install size and reason.
 */
export async function readUpdateThread(name: string, currentVersion: string | null): Promise<UpdateThread> {
  let pending = { currentVersion: "", newVersion: "" };
  for (const entry of (await readPendingUpdates()).updates) {
    if (entry.name === name) {
      pending = entry;
      break;
    }
  }
  if (!pending.newVersion) throw new UpdateNotFound(name);

  let info: Record<string, string> = {};
  try {
    const { stdout } = await execFileAsync("pacman", ["-Si", name]);
    info = parsePacmanFields(stdout);
  } catch {
    // Package may have been renamed or is an AUR build — thread still works
    // with the version pair alone.
  }
  let installed: Record<string, string> = {};
  try {
    const { stdout } = await execFileAsync("pacman", ["-Qi", name]);
    installed = parsePacmanFields(stdout);
  } catch {
    // Not installed locally (e.g. removed since the list was built).
  }

  return UPDATE_THREAD_SCHEMA.parse({
    name,
    repo: info["Repository"] ?? "unknown",
    currentVersion: pending.currentVersion || "unknown",
    newVersion: pending.newVersion,
    description: info["Description"] ?? null,
    dependencies: splitList(info["Depends On"]),
    provides: splitList(info["Provides"]),
    installSizeBytes:
      sizeToBytes(installed["Installed Size"] ?? "") ?? sizeToBytes(info["Installed Size"] ?? ""),
    installReason: installed["Install Reason"] ?? null,
  });
}
