import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { googleExchangeCode } from "@/lib/mail/google";

/**
 * Gmail OAuth callback: verify the state cookie (CSRF, docs-required),
 * exchange the code, resolve identity and store tokens ENCRYPTED via the
 * store. Landing page is `/` with a `?mail=` flag for now — when the mail
 * page (7a, step 5) exists both mail callbacks switch to it in one commit.
 * Tokens never appear in this route's logs or redirects.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state");
  const code = params.get("code");
  const oauthError = params.get("error");

  const stateCookie = request.cookies.get("secptile_mail_google_state")?.value;
  const home = (flag: string) =>
    new URL(`/?mail=${flag}`, request.nextUrl.origin);

  const back = (flag: string) => {
    const response = NextResponse.redirect(home(flag));
    response.cookies.set("secptile_mail_google_state", "", { path: "/", maxAge: 0 });
    return response;
  };

  if (oauthError) {
    console.error("[mail/google/callback] oauth error:", oauthError);
    return back("error");
  }
  if (!code || !state) {
    return back("error");
  }
  if (!stateCookie || stateCookie !== state) {
    // CSRF guard (docs: state must match the one we sent).
    return back("error");
  }

  try {
    await googleExchangeCode(code);
  } catch (error) {
    // MailError messages are sanitized; other shapes stay non-fatal too.
    console.error(
      "[mail/google/callback] exchange failed:",
      error instanceof Error ? error.message : error,
    );
    return back("error");
  }

  return back("connected");
}
