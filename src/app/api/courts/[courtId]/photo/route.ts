import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/withTenant";
import { resolveTenant } from "@/lib/tenant/resolve";

/**
 * Serves a court's photo on demand — only hit when a customer taps a court
 * header to view it, NOT on every (20s-polled) grid load. The grid ships only
 * a `hasImage` flag now; the ~200-260 KB image lives here behind a cacheable
 * response so a repeat view is a browser/CDN cache hit, never a re-query.
 *
 * Court photos are public customer-facing content, so no auth beyond tenant
 * scoping, and a public (shared-cacheable) Cache-Control.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ courtId: string }> }) {
  const { courtId } = await ctx.params;
  const tenant = await resolveTenant();

  const court = await withTenant(tenant.id, (tx) =>
    tx.court.findFirst({ where: { id: courtId, tenantId: tenant.id }, select: { imageUrl: true } })
  );
  const url = court?.imageUrl;
  if (!url) return new NextResponse("Not found", { status: 404 });

  // Externally-hosted image — redirect the browser to the real URL.
  if (!url.startsWith("data:")) return NextResponse.redirect(url);

  // Inline data: URI — decode and serve the raw bytes with a cacheable header.
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url);
  if (!match) return new NextResponse("Not found", { status: 404 });
  const mime = match[1] || "image/jpeg";
  const data = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8");

  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" },
  });
}
