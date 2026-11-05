import { NextResponse } from "next/server";
import { connection } from "next/server";
import { z } from "zod";
import { getMailProvider } from "@/lib/mail/provider";
import { readMailToken } from "@/lib/mail/store";
import { googleConfigured } from "@/lib/mail/google";
import { zohoConfigured } from "@/lib/mail/zoho";
import {
  MAIL_PROVIDERS,
  MailError,
  type MailMessageSummary,
  type MailProviderId,
} from "@/lib/mail/types";

// Dynamic by convention (see status route) — live mailbox data must never
// be cached or prerendered.
const CONFIGURED: Record<MailProviderId, () => boolean> = {
  google: googleConfigured,
  zoho: zohoConfigured,
};

const querySchema = z.object({
  provider: z.enum(["all", "gmail", "zoho"]).default("all"),
  /** Base64url JSON map { [providerId]: providerCursor } — owned by this API. */
  cursor: z.string().max(512).nullable().optional(),
  search: z.string().max(240).optional(),
  pageSize: z.coerce.number().int().min(5).max(50).default(25),
});

type CursorMap = Partial<Record<MailProviderId, string | null>>;

type Issue = {
  provider: MailProviderId;
  code: "not_configured" | "not_connected" | "error";
  message: string;
  needsReconnect: boolean;
};

function encodeCursor(map: CursorMap): string | null {
  // Only providers with more pages keep a cursor entry.
  const live = Object.entries(map).filter(([, value]) => typeof value === "string");
  return live.length
    ? Buffer.from(JSON.stringify(Object.fromEntries(live)), "utf8").toString("base64url")
    : null;
}

function decodeCursor(raw: string | null | undefined): CursorMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    const entries = Object.entries(parsed as Record<string, unknown>);
    const map: CursorMap = {};
    for (const [key, value] of entries) {
      if ((MAIL_PROVIDERS as readonly string[]).includes(key) && typeof value === "string") {
        map[key as MailProviderId] = value;
      }
    }
    return map;
  } catch {
    return {}; // stale/garbled cursor = start from page one, not a crash
  }
}

function newestFirst(a: MailMessageSummary, b: MailMessageSummary): number {
  const ta = Number.isNaN(Date.parse(a.date)) ? 0 : Date.parse(a.date);
  const tb = Number.isNaN(Date.parse(b.date)) ? 0 : Date.parse(b.date);
  return tb - ta;
}

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid list query." },
      { status: 400 },
    );
  }
  await connection();

  const active: MailProviderId[] =
    parsed.data.provider === "all" ? [...MAIL_PROVIDERS] : [parsed.data.provider];
  // Merged mode asks each provider for half a page so a "page" stays a page.
  const perProvider =
    active.length > 1 ? Math.ceil(parsed.data.pageSize / 2) : parsed.data.pageSize;
  const cursors = decodeCursor(parsed.data.cursor);

  const issues: Issue[] = [];
  const items: MailMessageSummary[] = [];
  const nextFor: CursorMap = {};

  await Promise.all(
    active.map(async (id) => {
      if (!CONFIGURED[id]()) {
        issues.push({
          provider: id,
          code: "not_configured",
          message: `${id} OAuth is not set up on this machine yet (see README → E-mail).`,
          needsReconnect: false,
        });
        return;
      }
      let record = null;
      try {
        record = await readMailToken(id);
      } catch {
        record = null;
      }
      if (!record) {
        issues.push({
          provider: id,
          code: "not_connected",
          message: `${id} is not connected yet.`,
          needsReconnect: false,
        });
        return;
      }
      try {
        const page = await getMailProvider(id).listMessages({
          search: parsed.data.search?.trim() || undefined,
          cursor: cursors[id] ?? null,
          pageSize: perProvider,
        });
        items.push(...page.items);
        nextFor[id] = page.nextCursor;
      } catch (error) {
        const mail = error instanceof MailError ? error : null;
        issues.push({
          provider: id,
          code: "error",
          message: mail?.message ?? `${id} request failed unexpectedly.`,
          needsReconnect: Boolean(mail?.needsReconnect),
        });
      }
    }),
  );

  items.sort(newestFirst);

  return NextResponse.json({
    // Cursor map is only meaningful while the same provider selection is on;
    // the client resets it whenever the switcher changes.
    items,
    nextCursor: encodeCursor(nextFor),
    issues,
  });
}
