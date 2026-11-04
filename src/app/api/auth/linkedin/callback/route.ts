import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { exchangeCode } from "@/lib/linkedin";

/**
 * OAuth callback: verify state against the cookie, check LinkedIn's error
 * params, exchange the code, resolve the member URN, store the token record
 * (outside the repo), then head home. The home page restores an in-progress
 * day from sessionStorage — finishing a draft is never lost by connecting.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state");
  const code = params.get("code");
  const oauthError = params.get("error");

  const stateCookie = request.cookies.get("secptile_li_state")?.value;
  const tea = (flag: string) =>
    new URL(`/tea?linkedin=${flag}`, request.nextUrl.origin);

  const back = (flag: string) => {
    const response = NextResponse.redirect(tea(flag));
    response.cookies.set("secptile_li_state", "", { path: "/", maxAge: 0 });
    return response;
  };

  if (oauthError) {
    console.error("[linkedin/callback] oauth error:", params.get("error"));
    return back("error");
  }

  if (!code || !state) {
    return back("error");
  }
  if (!stateCookie || stateCookie !== state) {
    // CSRF guard (docs: the state must match the one we sent).
    return back("error");
  }

  try {
    await exchangeCode(code);
  } catch (error) {
    console.error("[linkedin/callback] exchange failed:", error);
    return back("error");
  }

  return back("connected");
}
