/**
 * What Secptile can look up, answered directly from the app with no model.
 * Mail and comments are untrusted text written by other people, so they are
 * shown and spoken, but never sent to a model. Everything here only reads.
 */
import "server-only";
import { listPosts } from "@/lib/blog/blog-db";
import { feedbackConfigured, listPendingComments } from "@/lib/feedback";
import { listHistory } from "@/lib/journal/history";
import { linkedinStatus } from "@/lib/linkedin/linkedin";
import { googleConfigured } from "@/lib/mail/google";
import { getMailProvider } from "@/lib/mail/provider";
import { readMailToken } from "@/lib/mail/store";
import { MAIL_PROVIDERS, type MailMessageSummary, type MailProviderId } from "@/lib/mail/types";
import { zohoConfigured } from "@/lib/mail/zoho";
import { readSystemStats } from "@/lib/system/system-stats";
import { readPendingUpdates } from "@/lib/system/updates";

export type ToolReply = {
  /** Said out loud and shown in the bubble. */
  text: string;
  /** Extra rows shown under the text, but not read out. */
  items?: string[];
  href?: string;
  hrefLabel?: string;
};

const MAIL_PAGE_SIZE = 25;
const MAX_ROWS = 5;
const SPOKEN_ROWS = 3;
const MAX_FIELD_CHARS = 80;
const PROVIDER_LABELS: Record<MailProviderId, string> = { google: "Gmail", zoho: "Zoho" };
const PROVIDER_CONFIGURED: Record<MailProviderId, () => boolean> = {
  google: googleConfigured,
  zoho: zohoConfigured,
};

function short(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_FIELD_CHARS ? `${clean.slice(0, MAX_FIELD_CHARS - 1)}…` : clean;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function sender(message: MailMessageSummary): string {
  return short(message.from?.name || message.from?.email || "someone unknown");
}

function subject(message: MailMessageSummary): string {
  return short(message.subject || "no subject");
}

export async function checkMail(): Promise<ToolReply> {
  const unread: MailMessageSummary[] = [];
  const checked: string[] = [];
  const failed: string[] = [];

  await Promise.all(
    MAIL_PROVIDERS.map(async (id) => {
      if (!PROVIDER_CONFIGURED[id]()) return;
      const token = await readMailToken(id).catch(() => null);
      if (!token) return;
      try {
        const page = await getMailProvider(id).listMessages({ pageSize: MAIL_PAGE_SIZE });
        unread.push(...page.items.filter((message) => message.unread));
        checked.push(PROVIDER_LABELS[id]);
      } catch {
        failed.push(PROVIDER_LABELS[id]);
      }
    }),
  );

  const mailLink = { href: "/mail", hrefLabel: "Open Mail" };
  if (checked.length === 0) {
    return {
      text: failed.length
        ? `I couldn't reach ${failed.join(" or ")}. You may need to reconnect it in Mail.`
        : "No mail account is connected yet. You can connect one in Mail.",
      ...mailLink,
    };
  }

  const problem = failed.length ? ` I couldn't reach ${failed.join(" or ")}.` : "";
  if (unread.length === 0) {
    return {
      text: `No new mail in the latest ${MAIL_PAGE_SIZE} messages of ${checked.join(" and ")}.${problem}`,
      ...mailLink,
    };
  }

  unread.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  const spoken = unread
    .slice(0, SPOKEN_ROWS)
    .map((message) => `from ${sender(message)}, about ${subject(message)}`)
    .join("; ");
  return {
    text: `${plural(unread.length, "unread email")} in your latest messages on ${checked.join(" and ")}. Newest: ${spoken}.${problem}`,
    items: unread.slice(0, MAX_ROWS).map((message) => `${sender(message)}: ${subject(message)}`),
    ...mailLink,
  };
}

export async function postsSummary(): Promise<ToolReply> {
  const posts = listPosts();
  const link = { href: "/tracker", hrefLabel: "Open Tracker" };
  if (posts.length === 0) return { text: "You haven't published anything through Secptile yet.", ...link };
  const views = posts.reduce((total, post) => total + post.views, 0);
  const onLinkedIn = posts.filter((post) => post.linkedInUrn).length;
  const latest = [...posts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return {
    text: `You've published ${plural(posts.length, "post")}, ${onLinkedIn} of them on LinkedIn, with ${plural(views, "view")} in total. The latest is ${short(latest[0].title)}.`,
    items: latest.slice(0, MAX_ROWS).map((post) => `${short(post.title)} (${plural(post.views, "view")})`),
    ...link,
  };
}

export async function feedbackSummary(): Promise<ToolReply> {
  const link = { href: "/feedback", hrefLabel: "Open Feedback" };
  if (!feedbackConfigured()) return { text: "Blog feedback isn't set up on this machine yet.", ...link };
  const pending = await listPendingComments();
  if (pending.length === 0) return { text: "No comments are waiting for review.", ...link };
  return {
    text: `${plural(pending.length, "comment")} ${pending.length === 1 ? "is" : "are"} waiting for your review.`,
    items: pending
      .slice(0, MAX_ROWS)
      .map((comment) => `${short(comment.authorName)}${comment.postTitle ? ` on ${short(comment.postTitle)}` : ""}`),
    ...link,
  };
}

export async function historySummary(): Promise<ToolReply> {
  const entries = await listHistory();
  if (entries.length === 0) return { text: "There are no past days saved yet." };
  return {
    text: `You have ${plural(entries.length, "past day")} saved. They're listed under this chat.`,
    items: entries.slice(0, MAX_ROWS).map((entry) => short(entry.title)),
  };
}

export async function linkedinSummary(): Promise<ToolReply> {
  const status = await linkedinStatus();
  const link = { href: "/tea", hrefLabel: "Open Today's Tea" };
  if (!status.configured) return { text: "LinkedIn isn't set up on this machine yet.", ...link };
  if (!status.connected) return { text: "LinkedIn isn't connected. You can connect it in Today's Tea.", ...link };
  const days = status.expiresAt
    ? Math.ceil((Date.parse(status.expiresAt) - Date.now()) / 86_400_000)
    : null;
  if (days !== null && days <= 0) return { text: "Your LinkedIn connection has expired. Please reconnect it in Today's Tea.", ...link };
  return { text: `LinkedIn is connected${days !== null ? ` for another ${plural(days, "day")}` : ""}.`, ...link };
}

export async function updatesSummary(): Promise<ToolReply> {
  const pending = await readPendingUpdates();
  const link = { href: "/updates", hrefLabel: "Open Updates" };
  if (pending.updates.length === 0) return { text: "Your system is up to date.", ...link };
  return {
    text: `${plural(pending.updates.length, "update")} ${pending.updates.length === 1 ? "is" : "are"} waiting.`,
    items: pending.updates.slice(0, MAX_ROWS).map((update) => `${update.name}: ${update.newVersion}`),
    ...link,
  };
}

export async function systemSummary(): Promise<ToolReply> {
  const stats = await readSystemStats();
  const usedGb = (stats.ram.usedBytes / 1024 ** 3).toFixed(1);
  const totalGb = (stats.ram.totalBytes / 1024 ** 3).toFixed(1);
  const battery =
    stats.battery.present && stats.battery.capacityPct !== null
      ? ` Battery is at ${Math.round(stats.battery.capacityPct)} percent${stats.battery.charging ? " and charging" : ""}.`
      : "";
  return {
    text: `CPU is at ${Math.round(stats.cpu.usagePct)} percent, and you're using ${usedGb} of ${totalGb} gigabytes of memory.${battery}`,
    href: "/about",
    hrefLabel: "Open About",
  };
}

export function currentTime(): ToolReply {
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const date = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return { text: `It's ${time} on ${date}.` };
}
