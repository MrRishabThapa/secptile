import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { finishKartabyaLogin } from "@/lib/kartabya/client";

/** Finishes the Kartabya sign-in, then returns to Chat. Tokens are never logged. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const savedState = request.cookies.get("secptile_kartabya_state")?.value;
  const verifier = request.cookies.get("secptile_kartabya_verifier")?.value;

  let connected = false;
  if (code && state && savedState === state && verifier) {
    try {
      await finishKartabyaLogin(code, verifier);
      connected = true;
    } catch (error) {
      console.error("[kartabya/callback] failed:", error instanceof Error ? error.message : "unknown");
    }
  }

  const response = NextResponse.redirect(
    new URL(`/?kartabya=${connected ? "connected" : "error"}`, request.nextUrl.origin),
  );
  response.cookies.set("secptile_kartabya_state", "", { path: "/", maxAge: 0 });
  response.cookies.set("secptile_kartabya_verifier", "", { path: "/", maxAge: 0 });
  return response;
}
