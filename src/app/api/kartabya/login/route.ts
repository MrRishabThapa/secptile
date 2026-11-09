import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { KartabyaError, startKartabyaLogin } from "@/lib/kartabya/client";

/**
 * Starts the Kartabya sign-in. The state cookie guards against forged callbacks
 * and the verifier cookie proves the callback belongs to this browser (PKCE).
 */
const COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 } as const;

export async function GET(request: NextRequest) {
  try {
    const redirectUri = new URL("/api/kartabya/callback", request.nextUrl.origin).toString();
    const { url, state, verifier } = await startKartabyaLogin(redirectUri);
    const response = NextResponse.redirect(url);
    response.cookies.set("secptile_kartabya_state", state, COOKIE_OPTIONS);
    response.cookies.set("secptile_kartabya_verifier", verifier, COOKIE_OPTIONS);
    return response;
  } catch (error) {
    const message = error instanceof KartabyaError ? error.message : "Couldn't start the Kartabya sign-in.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
