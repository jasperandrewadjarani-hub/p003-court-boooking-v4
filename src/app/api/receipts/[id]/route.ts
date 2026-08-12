import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/withTenant";
import { resolveTenant } from "@/lib/tenant/resolve";
import { getCurrentCustomer } from "@/lib/auth/customerAuth";
import { readReceiptData } from "@/lib/storage/receipts";

/**
 * Serves a locally-stored (Postgres bytea) receipt back — only used by the
 * $0 fallback transport (src/lib/storage/receipts.ts); once real Supabase
 * Storage is configured, receipts are served directly from its own public/
 * signed URLs instead and this route stops being hit for new uploads.
 *
 * Access control for this phase: the uploading customer only (matches
 * what's built — Phase E1 adds staff access for admin receipt review).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const tenant = await resolveTenant();
  const customer = await getCurrentCustomer();
  if (!customer) return new NextResponse("Not found", { status: 404 });

  const result = await withTenant(tenant.id, async (tx) => {
    const receipt = await tx.receipt.findUnique({ where: { id }, include: { bookingGroup: true } });
    if (!receipt || receipt.bookingGroup.customerId !== customer.id) return null;
    return readReceiptData(tx, id);
  });

  if (!result) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(result.data), {
    headers: { "Content-Type": result.mimeType, "Cache-Control": "private, max-age=3600" },
  });
}
