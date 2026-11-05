import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { zohoExchangeCode } from "@/lib/mail/zoho";

/**
 * Zoho OAuth callback: verify the state cookie (CSRF, docs-required), check
 * the data-center echo (docs: the redirect carries location=<dc> and
 * accounts-server=<URL> — a mismatch means the user's Zoho lives on a
 * different data center than ZOHO_ACCOUNTS_DOMAIN and the token would not
 * authorize mail.zoho.{dc}); exchange the code (valid 2 minutes), resolve
 * the mailbox + Inbox folder and store tokens ENCRYPTED. Landing page is
 * `/` with a `?mail=` flag until the mail page (7a, step 5) exists.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state");
  const code = params.get("code");
  const oauthError = params.get("error");
  const accountsServer = params.get("accounts-server");

  const stateCookie = request.cookies.get("secptile_mail_zoho_state")?.value;
  const home = (flag: string) => new URL(`/?mail=${flag}`, request.nextUrl.origin);

  const back = (flag: string) => {
    const response = NextResponse.redirect(home(flag));
    response.cookies.set("secptile_mail_zoho_state", "", { path: "/", maxAge: 0 });
    return response;
  };

  if (oauthError) {
    console.error("[mail/zoho/callback] oauth error:", oauthError);
    return back("error");
  }
  if (!code || !state) {
    return back("error");
  }
  if (!stateCookie || stateCookie !== state) {
    // CSRF guard (docs: state must match the one we sent).
    return back("error");
  }
  // Data-center echo consistency: refuse a token minted elsewhere — tokens
  // from accounts.zoho.eu do NOT authorize mail.zoho.com. Only domain NAMES
  // are compared/logged (no secrets in either side).
  if (accountsServer) {
    const echoDomain = (() => {
      try {
        return new URL(decodeURIComponent(accountsServer)).hostname;
      } catch {
        return "";
      }
    })();
    const expected = (process.env.ZOHO_ACCOUNTS_DOMAIN?.trim() || "accounts.zoho.com")
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "");
    if (echoDomain && echoDomain !== expected) {
      console.error(
        `[mail/zoho/callback] data-center mismatch: user's Zoho is on ${echoDomain}, app expects ${expected} — set ZOHO_ACCOUNTS_DOMAIN (and ZOHO_MAIL_API_DOMAIN) to it.`,
      );
      return back("dc_mismatch");
    }
  }

  try {
    await zohoExchangeCode(code);
  } catch (error) {
    // MailError messages are sanitized; other shapes stay non-fatal too.
    console.error(
      "[mail/zoho/callback] exchange failed:",
      error instanceof Error ? error.message : error,
    );
    return back("error");
  }

  return back("connected");
}
