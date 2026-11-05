import { NextResponse } from "next/server";
import { connection } from "next/server";
import { readMailToken } from "@/lib/mail/store";
import { googleConfigured, googleTokenCanSend } from "@/lib/mail/google";
import { zohoConfigured, zohoTokenCanSend } from "@/lib/mail/zoho";
import { MAIL_PROVIDERS, type MailProviderId } from "@/lib/mail/types";

// cacheComponents convention in this repo: route handlers opt out of
// prerender explicitly so connection state is always read fresh.
// Never cached — a stale "connected" would hide a dead token and a stale
// "disconnected" would hide a fresh one.

const LABELS: Record<MailProviderId, string> = { google: "Gmail", zoho: "Zoho" };
const CONFIGURED: Record<MailProviderId, () => boolean> = {
  google: googleConfigured,
  zoho: zohoConfigured,
};
const CAN_SEND: Record<MailProviderId, (scope: string) => boolean> = {
  google: googleTokenCanSend,
  zoho: zohoTokenCanSend,
};

/**
 * Per-provider connection state for the inbox UI pills:
 * configured (env creds + MAIL_ENCRYPTION_KEY), connected (a decryptable,
 * complete token record) and needsReconnect (record lacks a refresh token
 * — it will die at the next refresh, ask to reconnect now).
 */
export async function GET() {
  await connection();
  const providers = await Promise.all(
    MAIL_PROVIDERS.map(async (id) => {
      let record = null;
      try {
        record = await readMailToken(id);
      } catch {
        record = null; // store failures surface as "not connected" + Reconnect
      }
      return {
        id,
        label: LABELS[id],
        configured: CONFIGURED[id](),
        connected: Boolean(record),
        accountEmail: record?.accountEmail ?? null,
        needsReconnect: Boolean(record && !record.refreshToken),
        /** 7d: the stored scope actually grants send (false until reconnect). */
        canSend: Boolean(record && CAN_SEND[id](record.scope)),
      };
    }),
  );
  return NextResponse.json({ providers });
}
