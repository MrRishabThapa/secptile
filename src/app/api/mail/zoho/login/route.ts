import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { authorizeUrl, zohoConfigured } from "@/lib/mail/zoho";
import { mailEncryptionKeyValid } from "@/lib/mail/crypto";

/**
 * Start of the Zoho OAuth flow (Server-based client from the Zoho API
 * Console). Zoho-specific: the data-center accounts domain is ENV-driven
 * (ZOHO_ACCOUNTS_DOMAIN, default accounts.zoho.com) and the grant code is
 * valid for only two minutes — the callback must be right behind it.
 * The proxy marks this route OAuth-exempt; the state cookie is the gate.
 */
export async function GET() {
  if (!process.env.ZOHO_CLIENT_ID?.trim() || !process.env.ZOHO_CLIENT_SECRET?.trim()) {
    return NextResponse.json(
      {
        error:
          "Zoho Mail OAuth is not configured — set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in .env.local.",
      },
      { status: 500 },
    );
  }
  if (!mailEncryptionKeyValid()) {
    return NextResponse.json(
      {
        error:
          'MAIL_ENCRYPTION_KEY is missing or not 64 hex chars — generate one with "openssl rand -hex 32" into .env.local.',
      },
      { status: 500 },
    );
  }

  const state = randomBytes(16).toString("hex");
  const response = NextResponse.redirect(authorizeUrl(state));
  response.cookies.set("secptile_mail_zoho_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // generous vs. the 2-minute code; covers slow handoffs too
  });
  return response;
}
