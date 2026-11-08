import { NextResponse } from "next/server";
import { authorizeUrl, linkedinConfigured } from "@/lib/linkedin/linkedin";
import { randomBytes } from "node:crypto";

/**
 * Start of the 3-legged OAuth flow: set a CSRF state cookie and redirect to
 * LinkedIn's authorization screen (docs: authorization-code-flow, state must
 * be verified on callback).
 */
export async function GET() {
  if (!linkedinConfigured()) {
    return NextResponse.json(
      {
        error:
          "LinkedIn OAuth is not configured — set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in .env.local.",
      },
      { status: 500 },
    );
  }

  const state = randomBytes(16).toString("hex");
  const response = NextResponse.redirect(authorizeUrl(state));
  response.cookies.set("secptile_li_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // the authorization code itself is valid 30 minutes
  });
  return response;
}
