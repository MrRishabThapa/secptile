/**
 * Proxy (Next.js 16's renamed middleware — `middleware.ts` is deprecated):
 * a passport check for the API surface only. Page navigations never pass
 * through here (the matcher is /api/*), so the UI is untouched.
 *
 * Secptile serves localhost on one port (systemd: `next start -p 3100`,
 * Phase 6 daemon + README assume it). This file makes that assumption a
 * policy instead of a hope:
 *
 *  1. Host must be `localhost` / `127.0.0.1` / `[::1]` on the configured
 *     port. The port is configuration — SECPTILE_PORT, then PORT, then the
 *     documented default 3100 — never hardcoded here.
 *  2. Browsers send `Sec-Fetch-Site` on cross-site deliveries; ours arrive
 *     `same-origin`. If the header is present it must be `same-origin`.
 *     When it is ABSENT (the Phase 6 daemon, curl, scripts, server-to-server
 *     fetches) the request is allowed through — those routes protect
 *     themselves (the daemon keeps its own `daemonAuthorized` secret check).
 *
 * OAuth login/callback routes are explicitly exempt: the provider delivers
 * the user back cross-site, which rule 2 would otherwise reject. They stays
 * protected by the CSRF `state` cookie the routes themselves verify.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PORT =
  process.env.SECPTILE_PORT?.trim() || process.env.PORT?.trim() || "3100";

const ALLOWED_HOSTS = new Set(
  ["localhost", "127.0.0.1", "[::1]"].map((host) => `${host}:${PORT}`),
);

/** OAuth entry points — cross-site by design, guarded by state cookies. */
const OAUTH_EXEMPT = [
  /^\/api\/auth\/linkedin\/(start|callback)$/,
  // Phase 7 mail providers follow the same shape (e.g. /api/mail/google/callback).
  /^\/api\/mail\/[^/]+\/(login|callback)$/,
];

export function proxy(request: NextRequest): NextResponse {
  const pathname = request.nextUrl.pathname;
  if (OAUTH_EXEMPT.some((pattern) => pattern.test(pathname))) {
    return NextResponse.next();
  }

  const host = request.headers.get("host");
  if (!host || !ALLOWED_HOSTS.has(host.toLowerCase())) {
    return NextResponse.json({ error: "Unrecognized host." }, { status: 403 });
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite.toLowerCase() !== "same-origin") {
    return NextResponse.json(
      { error: "Cross-site API calls are not allowed." },
      { status: 403 },
    );
  }

  return NextResponse.next();
}

export const config = {
  // API routes only — page navigations, RSC fetches and Server Actions
  // (which POST to page routes, not /api) are never touched.
  matcher: "/api/:path*",
};
