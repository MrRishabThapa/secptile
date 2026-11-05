import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { authorizeUrl, googleConfigured } from "@/lib/mail/google";
import { mailEncryptionKeyValid } from "@/lib/mail/crypto";

/**
 * Start of the Gmail OAuth flow: guard the prerequisites, set a CSRF state
 * cookie, redirect to Google's authorization screen (docs: state must be
 * verified on callback; prompt=consent keeps refresh tokens flowing on
 * reconnects). The proxy marks this route as OAuth-exempt — cross-site by
 * design — so the state cookie is the gate here.
 */
export async function GET() {
  if (!process.env.GOOGLE_CLIENT_ID?.trim() || !process.env.GOOGLE_CLIENT_SECRET?.trim()) {
    return NextResponse.json(
      {
        error:
          "Gmail OAuth is not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local.",
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
  response.cookies.set("secptile_mail_google_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // the authorization code itself is valid 30 minutes
  });
  return response;
}
