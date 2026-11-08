import { z } from "zod";

/**
 * Client-safe contract for the Updates surface. Shared by the API routes
 * (server validation) and the /updates page (client import) — kept free of
 * node-only imports so both bundles can load it.
 */

/** One pending package update from `checkupdates`. */
export const PENDING_UPDATES_SCHEMA = z.object({
  hostname: z.string(),
  /** ISO timestamp of when the pending list was read. */
  checkedAt: z.string(),
  updates: z.array(
    z.object({
      name: z.string(),
      currentVersion: z.string(),
      newVersion: z.string(),
    }),
  ),
});

export type PendingUpdates = z.infer<typeof PENDING_UPDATES_SCHEMA>;

/** Everything known locally about one package, for its update thread. */
export const UPDATE_THREAD_SCHEMA = z.object({
  name: z.string(),
  repo: z.string(),
  currentVersion: z.string(),
  newVersion: z.string(),
  description: z.string().nullable(),
  dependencies: z.array(z.string()),
  provides: z.array(z.string()),
  installSizeBytes: z.number().nonnegative().nullable(),
  installReason: z.string().nullable(),
});

export type UpdateThread = z.infer<typeof UPDATE_THREAD_SCHEMA>;
