/**
 * Local record of every email Secptile sent (Phase 7d) — metadata ONLY:
 * when, provider, recipients, subject. Bodies are never logged. Lives
 * outside the repo at `~/.secptile/mail-sent.json` (0600, like mail.json)
 * so a future Tracker surface can show the sending history without any
 * provider round-trip. Never exposed to the client verbatim; append-only
 * from the send route.
 */
import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { MailProviderId } from "./types";

export type MailSentEntry = {
  /** ISO timestamp of the send. */
  ts: string;
  provider: MailProviderId;
  /** Resolved later from the connected account; route does not fake it. */
  from?: string;
  to: string[];
  cc: string[];
  subject: string;
  /** Whether it was a reply (no content is ever kept). */
  reply: boolean;
  /** Provider's send id when it reported one (Gmail), null otherwise. */
  providerMessageId: string | null;
};

const MAX_ENTRIES = 500;

export function sentLogPath(): string {
  return path.join(homedir(), ".secptile", "mail-sent.json");
}

/** Append one send; the log stays a bounded JSON array for easy reading. */
export async function logSentMail(entry: MailSentEntry): Promise<void> {
  const file = sentLogPath();
  let previous: MailSentEntry[] = [];
  try {
    const raw = JSON.parse(await readFile(file, "utf8"));
    if (Array.isArray(raw)) {
      previous = raw.filter(
        (item): item is MailSentEntry =>
          item && typeof item === "object" && typeof (item as MailSentEntry).ts === "string",
      );
    }
  } catch {
    // Missing or corrupted log: a fresh one starts with this entry.
  }
  const next = [entry, ...previous].slice(0, MAX_ENTRIES);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}
