/**
 * What Secptile can do in Kartabya. Answers are built right here, so other
 * people's messages are shown and spoken but never sent to a model.
 *
 * Posting is two steps. prepareSend only remembers the exact text, and
 * confirmSend posts that text, once, after the owner says yes (a voice
 * read-back the owner chose over a click for this one action).
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { ToolReply } from "@/lib/secptile/tools";
import { KartabyaError, callKartabyaTool, kartabyaConnected } from "./client";

const CONNECT_LINK = { href: "/api/kartabya/login", hrefLabel: "Connect Kartabya" };
const NOT_CONNECTED: ToolReply = {
  text: "Kartabya isn't connected yet. Click below to sign in once.",
  ...CONNECT_LINK,
};
const MESSAGES_PER_CHANNEL = 30;
const LATEST_IN_CHANNEL = 5;
const MAX_ROWS = 6;
const SPOKEN_ROWS = 3;
const MAX_FIELD_CHARS = 90;
const FIRST_CHECK_WINDOW_MS = 24 * 60 * 60_000;
/** A read-back can't be confirmed long after it was heard. */
const SEND_EXPIRES_MS = 60_000;

function short(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_FIELD_CHARS ? `${clean.slice(0, MAX_FIELD_CHARS - 1)}…` : clean;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "Shishir Khatri (@shishir)" reads aloud as "Shishir Khatri". */
function speakerName(from: string): string {
  return from.replace(/\s*\(@[^)]*\)\s*$/, "").trim() || from;
}

const channelsSchema = z.array(
  z.object({
    group: z.string().optional(),
    channels: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
);

const messagesSchema = z.object({
  channel: z.string().optional(),
  hasMore: z.boolean().optional(),
  messages: z.array(
    z.object({ id: z.string(), from: z.string(), at: z.string(), text: z.string() }),
  ),
});

const tasksSchema = z.object({
  open: z.array(z.object({ label: z.string(), assignedBy: z.string().nullable().optional() })),
  doneToday: z.array(z.object({ label: z.string() })),
});

const mentionsSchema = z.object({
  unseen: z.number(),
  mentions: z.array(z.record(z.string(), z.unknown())),
});

/** Runs a lookup, turning a missing login or an outage into a spoken answer. */
async function guarded(run: () => Promise<ToolReply>): Promise<ToolReply> {
  if (!(await kartabyaConnected())) return NOT_CONNECTED;
  try {
    return await run();
  } catch (error) {
    if (error instanceof KartabyaError) {
      return error.needsConnect
        ? { text: "Your Kartabya login needs renewing. Click below to sign in again.", ...CONNECT_LINK }
        : { text: "I couldn't reach Kartabya just now. Please try again in a moment." };
    }
    console.error("[kartabya] unexpected reply:", error instanceof Error ? error.message : error);
    return { text: "Kartabya replied in a way I didn't understand." };
  }
}

async function listChannels(): Promise<{ id: string; name: string }[]> {
  const groups = channelsSchema.parse(await callKartabyaTool("list_channels"));
  return groups.flatMap((group) => group.channels);
}

function findChannel(channels: { id: string; name: string }[], wanted: string) {
  const name = wanted.toLowerCase().replace(/^#/, "");
  return channels.find((channel) => channel.name.toLowerCase() === name);
}

function seenFile(): string {
  return path.join(homedir(), ".secptile", "kartabya-seen.json");
}

async function readSeen(): Promise<Record<string, string>> {
  try {
    return z.record(z.string(), z.string()).parse(JSON.parse(await readFile(seenFile(), "utf8")));
  } catch {
    return {};
  }
}

async function writeSeen(seen: Record<string, string>): Promise<void> {
  await mkdir(path.dirname(seenFile()), { recursive: true, mode: 0o700 });
  await writeFile(seenFile(), `${JSON.stringify(seen, null, 2)}\n`, { mode: 0o600 });
}

type NewMessage = { channel: string; from: string; text: string; at: string };

async function collectNewMessages(): Promise<{ fresh: NewMessage[]; seen: Record<string, string> }> {
  const channels = await listChannels();
  const seen = await readSeen();
  const firstCheck = new Date(Date.now() - FIRST_CHECK_WINDOW_MS).toISOString();
  const fresh: NewMessage[] = [];
  await Promise.all(
    channels.map(async (channel) => {
      const reply = messagesSchema.parse(
        await callKartabyaTool("read_messages", { channel: channel.id, limit: MESSAGES_PER_CHANNEL }),
      );
      const since = seen[channel.id] ?? firstCheck;
      for (const message of reply.messages) {
        if (message.at > since) {
          fresh.push({ channel: channel.name, from: message.from, text: message.text, at: message.at });
        }
      }
      const newest = reply.messages.at(-1)?.at;
      if (newest) seen[channel.id] = newest;
    }),
  );
  fresh.sort((a, b) => b.at.localeCompare(a.at));
  return { fresh, seen };
}

/** What's new across channels since you last asked, or in one channel. */
export function kartabyaMessages(channelName?: string): Promise<ToolReply> {
  return guarded(async () => {
    if (channelName) {
      const channels = await listChannels();
      const channel = findChannel(channels, channelName);
      if (!channel) {
        return { text: `I can't find a channel called ${channelName}. You have ${channels.map((c) => c.name).join(" and ")}.` };
      }
      const reply = messagesSchema.parse(
        await callKartabyaTool("read_messages", { channel: channel.id, limit: LATEST_IN_CHANNEL }),
      );
      if (reply.messages.length === 0) return { text: `${channel.name} has no messages yet.` };
      const newest = reply.messages.at(-1)!;
      return {
        text: `Latest in ${channel.name}: ${speakerName(newest.from)} said ${short(newest.text)}.`,
        items: reply.messages.map((message) => `${speakerName(message.from)}: ${short(message.text)}`),
      };
    }

    const { fresh, seen } = await collectNewMessages();
    await writeSeen(seen);
    if (fresh.length === 0) return { text: "No new messages in Kartabya." };
    const spoken = fresh
      .slice(0, SPOKEN_ROWS)
      .map((message) => `in ${message.channel}, ${speakerName(message.from)} said ${short(message.text)}`)
      .join("; ");
    return {
      text: `${plural(fresh.length, "new message")} in Kartabya. Newest: ${spoken}.`,
      items: fresh
        .slice(0, MAX_ROWS)
        .map((message) => `#${message.channel} ${speakerName(message.from)}: ${short(message.text)}`),
    };
  });
}

export function kartabyaMentions(): Promise<ToolReply> {
  return guarded(async () => {
    const reply = mentionsSchema.parse(await callKartabyaTool("list_mentions", { limit: MAX_ROWS }));
    if (reply.unseen === 0) return { text: "Nobody has mentioned you lately." };
    return { text: `${plural(reply.unseen, "unseen mention")} in Kartabya. Open the app to see them.` };
  });
}

export function kartabyaTasks(): Promise<ToolReply> {
  return guarded(async () => {
    const tasks = tasksSchema.parse(await callKartabyaTool("list_tasks"));
    if (tasks.open.length === 0) {
      return { text: `No open tasks. You finished ${plural(tasks.doneToday.length, "task")} today.` };
    }
    return {
      text: `You have ${plural(tasks.open.length, "open task")}, and you finished ${tasks.doneToday.length} today. Next: ${short(tasks.open[0].label)}.`,
      items: tasks.open.slice(0, MAX_ROWS).map((task) => short(task.label)),
    };
  });
}

/** Task and mention counts. The server has no dashboard numbers to report yet. */
export function kartabyaStats(): Promise<ToolReply> {
  return guarded(async () => {
    const [tasks, mentions] = await Promise.all([
      callKartabyaTool("list_tasks").then((reply) => tasksSchema.parse(reply)),
      callKartabyaTool("list_mentions", { limit: 1 }).then((reply) => mentionsSchema.parse(reply)),
    ]);
    return {
      text: `In Kartabya you have ${plural(tasks.open.length, "open task")}, ${tasks.doneToday.length} finished today, and ${plural(mentions.unseen, "unseen mention")}. Learning scores and dashboard numbers aren't available to me yet.`,
    };
  });
}

/** Claude-to-Claude messages. Reading this inbox marks them as read for Claude Code too. */
export function kartabyaTeamInbox(): Promise<ToolReply> {
  return guarded(async () => {
    const reply = z
      .object({ messages: z.array(z.object({ from: z.string().optional(), text: z.string().optional() })).default([]) })
      .parse(await callKartabyaTool("read_team_inbox", { as: "claude-code", limit: MAX_ROWS }));
    if (reply.messages.length === 0) return { text: "No unread Team Claude messages." };
    return {
      text: `${plural(reply.messages.length, "unread Team Claude message")}.`,
      items: reply.messages.map((message) => `${message.from ?? "A Claude"}: ${short(message.text ?? "")}`),
    };
  });
}

type PendingSend = { id: string; channelId: string; channelName: string; text: string; expires: number };

function pendingStore(): Map<string, PendingSend> {
  const ref = globalThis as typeof globalThis & { __secptileKartabyaSends?: Map<string, PendingSend> };
  ref.__secptileKartabyaSends ??= new Map();
  return ref.__secptileKartabyaSends;
}

export type PrepareResult =
  | { reply: ToolReply }
  | { pendingSendId: string; text: string };

/** Posts nothing. Remembers the exact text, for confirmSend. */
export async function prepareSend(channelName: string, text: string): Promise<PrepareResult> {
  let result: PrepareResult | null = null;
  const reply = await guarded(async () => {
    const channels = await listChannels();
    const channel = findChannel(channels, channelName);
    if (!channel) {
      return { text: `I can't find a channel called ${channelName}. You have ${channels.map((c) => c.name).join(" and ")}.` };
    }
    const id = randomUUID();
    pendingStore().clear(); // only the latest read-back can ever be confirmed
    pendingStore().set(id, {
      id,
      channelId: channel.id,
      channelName: channel.name,
      text,
      expires: Date.now() + SEND_EXPIRES_MS,
    });
    result = { pendingSendId: id, text: `Send to ${channel.name}: ${text}. Say yes to send, or no to cancel.` };
    return { text: "" };
  });
  return result ?? { reply };
}

export function cancelSend(id: string): void {
  pendingStore().delete(id);
}

/** Posts the remembered text once. A turn can never change what gets posted. */
export async function confirmSend(id: string): Promise<ToolReply> {
  const pending = pendingStore().get(id);
  pendingStore().delete(id);
  if (!pending) return { text: "That message isn't waiting any more, so nothing was sent." };
  if (pending.expires < Date.now()) return { text: "That took too long, so I didn't send it. Please ask again." };
  return guarded(async () => {
    await callKartabyaTool("send_message", { channel: pending.channelId, text: pending.text });
    return { text: `Sent to ${pending.channelName}.` };
  });
}
