import { z } from "zod";

/**
 * Client-safe contract for system stats. Shared by the API route (server
 * validation) and the About page (client import) — kept free of node-only
 * imports so both bundles can load it.
 */

export const SYSTEM_STATS_SCHEMA = z.object({
  host: z.object({
    hostname: z.string(),
    device: z.string().nullable(),
    os: z.string(),
    kernel: z.string(),
    uptimeSec: z.number().nonnegative(),
  }),
  cpu: z.object({
    model: z.string(),
    logicalCores: z.number().int().positive(),
    usagePct: z.number().min(0).max(100),
    perCorePct: z.array(z.number().min(0).max(100)),
    mhz: z.number().nonnegative(),
  }),
  gpu: z.object({
    name: z.string().nullable(),
    /** Integrated GPUs expose no utilization counter without extra tooling. */
    usagePct: z.number().min(0).max(100).nullable(),
    currentMhz: z.number().nonnegative().nullable(),
    maxMhz: z.number().nonnegative().nullable(),
  }),
  ram: z.object({
    totalBytes: z.number().nonnegative(),
    usedBytes: z.number().nonnegative(),
    swapTotalBytes: z.number().nonnegative(),
    swapUsedBytes: z.number().nonnegative(),
    topApps: z.array(
      z.object({
        name: z.string(),
        processes: z.number().int().positive(),
        rssBytes: z.number().nonnegative(),
        sharePct: z.number().min(0).max(100),
      }),
    ),
  }),
  battery: z.object({
    present: z.boolean(),
    capacityPct: z.number().min(0).max(100).nullable(),
    charging: z.boolean().nullable(),
    healthPct: z.number().min(0).max(100).nullable(),
    cycleCount: z.number().int().nonnegative().nullable(),
  }),
  storage: z.object({
    disks: z.array(
      z.object({
        /** Kernel device name without /dev/ — e.g. "nvme0n1p2". */
        name: z.string(),
        mount: z.string(),
        totalBytes: z.number().nonnegative(),
        usedBytes: z.number().nonnegative(),
      }),
    ),
  }),
});

export type SystemStats = z.infer<typeof SYSTEM_STATS_SCHEMA>;
