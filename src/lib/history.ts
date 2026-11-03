/**
 * History of past days (Phase 6): every finished journal session lands in
 * ~/.secptile/history/ as one JSON file keyed by day + session. Records are
 * small and local — data storage requirements of the LinkedIn API are met by
 * keeping it out of any repo and out of the client until requested.
 */
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

const recordSchema = z.object({
  sessionId: z.string().min(1),
  createdAt: z.string(), // ISO
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  /** transcript is private context — kept locally, sent nowhere else */
  transcript: z.string().optional(),
  portfolioFile: z.string().nullable().default(null),
  portfolioCommit: z.string().nullable().default(null),
  linkedInUrn: z.string().nullable().default(null),
});

export type HistoryRecord = z.infer<typeof recordSchema>;

function historyDir(): string {
  return (
    process.env.SECPTILE_HISTORY_DIR?.trim() ||
    path.join(homedir(), ".secptile", "history")
  );
}

/**
 * Draft records: files share the session id so upserts are stable no matter
 * how many times the owner regenerates.
 */
function fileName(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
  if (!safe) throw new Error("sessionId contains no usable characters.");
  return `${safe}.json`;
}

function filePath(sessionId: string): string {
  return path.join(historyDir(), fileName(sessionId));
}

/** Read-modify-write keeps published statuses across regenerations. */
async function existing(sessionId: string): Promise<HistoryRecord | null> {
  try {
    const raw = await readFile(filePath(sessionId), "utf8");
    return recordSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export type DraftInput = Pick<HistoryRecord, "title" | "body" | "tags"> & {
  transcript?: string;
};

export async function upsertDraftSession(
  sessionId: string,
  draft: DraftInput,
): Promise<void> {
  const dir = historyDir();
  await mkdir(dir, { recursive: true });
  const prior = await existing(sessionId);
  const record: HistoryRecord = recordSchema.parse({
    sessionId,
    createdAt: prior?.createdAt ?? new Date().toISOString(),
    title: draft.title,
    body: draft.body,
    tags: draft.tags,
    transcript: draft.transcript ?? prior?.transcript,
    portfolioFile: prior?.portfolioFile ?? null,
    portfolioCommit: prior?.portfolioCommit ?? null,
    linkedInUrn: prior?.linkedInUrn ?? null,
  });
  // Atomic-ish: write a tmp file then rename so a crash never truncates.
  const tmp = `${filePath(sessionId)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`);
  await rename(tmp, filePath(sessionId));
}

export type PublishStatus = {
  portfolioFile?: string;
  portfolioCommit?: string;
  linkedInUrn?: string;
};

export async function updateStatus(
  sessionId: string,
  status: PublishStatus,
): Promise<void> {
  const prior = await existing(sessionId);
  if (!prior) return; // history only records journal sessions that produced drafts
  const record = recordSchema.parse({
    ...prior,
    portfolioFile: status.portfolioFile ?? prior.portfolioFile,
    portfolioCommit: status.portfolioCommit ?? prior.portfolioCommit,
    linkedInUrn: status.linkedInUrn ?? prior.linkedInUrn,
  });
  await writeFile(filePath(sessionId), `${JSON.stringify(record, null, 2)}\n`);
}

export type HistoryEntry = Omit<HistoryRecord, "sessionId"> & {
  id: string;
};

/** All records, newest first. Body included — a personal-scale local store. */
export async function listHistory(): Promise<HistoryEntry[]> {
  const dir = historyDir();
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const entries: HistoryEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const record = recordSchema.parse(
        JSON.parse(await readFile(path.join(dir, name), "utf8")),
      );
      const { sessionId, ...rest } = record;
      entries.push({ id: sessionId, ...rest });
    } catch {
      // unreadable/corrupt record — skip it, don't 500 the list
    }
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
