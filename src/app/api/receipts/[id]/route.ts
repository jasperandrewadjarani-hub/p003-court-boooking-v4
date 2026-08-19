import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/withTenant";
import { resolveTenant } from "@/lib/tenant/resolve";
import { getCurrentCustomer } from "@/lib/auth/customerAuth";
import { getCurrentStaff } from "@/lib/auth/staffAuth";
import { readReceiptData } from "@/lib/storage/receipts";

/**
 * Serves a locally-stored (Postgres bytea) receipt back — only used by the
 * $0 fallback transport (src/lib/storage/receipts.ts); once real Supabase
 * Storage/Google Drive is configured, receipts are served directly from
 * their own signed URLs instead and this route stops being hit for new
 * uploads.
 *
 * Access control: the uploading customer can view their own receipt, OR any
 * staff member of the same tenant can view any receipt in that tenant (staff
 * need this to verify a payment during the Awaiting Verification review —
 * added 2026-08-19, the original build only ever wired the customer side).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const tenant = await resolveTenant();
  const [customer, staff] = await Promise.all([getCurrentCustomer(), getCurrentStaff()]);
  if (!customer && !staff) return new NextResponse("Not found", { status: 404 });

  const result = await withTenant(tenant.id, async (tx) => {
    const receipt = await tx.receipt.findUnique({ where: { id }, include: { bookingGroup: true } });
    if (!receipt || receipt.tenantId !== tenant.id) return null;
    const isOwner = customer && receipt.bookingGroup.customerId === customer.id;
    const isStaff = !!staff; // getCurrentStaff() is already tenant-scoped via the staff session
    if (!isOwner && !isStaff) return null;
    return readReceiptData(tx, id);
  });

  if (!result) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(result.data), {
    headers: { "Content-Type": result.mimeType, "Cache-Control": "private, max-age=3600" },
  });
}
