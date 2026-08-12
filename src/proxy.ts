import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 renamed `middleware.ts`/`middleware()` to `proxy.ts`/`proxy()`
// to clarify this runs at the network boundary (Node runtime only — no
// `edge` runtime here, unlike the old middleware convention).
//
// Host -> tenant resolution (master plan §5.3): every request's Host header
// is looked up against tenant_domains and the resolved tenant id is stamped
// onto a request header for server components/route handlers to read. This
// is resolution only — it does NOT set RLS scope; that happens per-request
// inside withTenant() at the point a database query actually runs (§5.2),
// never via a session-level SET on a pooled connection.
export function proxy(request: NextRequest) {
  const hostname = request.headers.get("host") ?? "";
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-tenant-hostname", hostname.toLowerCase());

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: [
    // Skip static assets and Next internals; resolve tenancy for everything else.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
