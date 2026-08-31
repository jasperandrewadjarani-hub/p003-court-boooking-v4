import { NextResponse } from "next/server";
import { resolveTenant } from "@/lib/tenant/resolve";
import { getBrandingMedia } from "@/lib/admin/settings";

/**
 * Serves a tenant's logo ("logo") or full header/banner logo ("header-logo")
 * on demand, behind a long-lived cacheable response — so the ~200-400 KB image
 * is downloaded ONCE and then served from browser/CDN cache, instead of being
 * re-read from Postgres and re-embedded in every (dynamic) page payload. The
 * bytes live in the branding_media setting key, off the hot branding read.
 *
 * The header <img> appends ?v=<mediaVersion>; that value changes whenever the
 * logo is re-saved, so `immutable` caching is safe and an updated logo shows up
 * immediately under its new URL.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  if (kind !== "logo" && kind !== "header-logo") {
    return new NextResponse("Not found", { status: 404 });
  }
  const tenant = await resolveTenant();
  const media = await getBrandingMedia(tenant.id);
  const url = kind === "header-logo" ? media.headerLogoUrl : media.logoUrl;
  if (!url) return new NextResponse("Not found", { status: 404 });

  // Externally-hosted image — redirect the browser to the real URL.
  if (!url.startsWith("data:")) return NextResponse.redirect(url);

  // Inline data: URI — decode and serve the raw bytes with a cacheable header.
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url);
  if (!match) return new NextResponse("Not found", { status: 404 });
  const mime = match[1] || "image/png";
  const data = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8");

  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": mime, "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
