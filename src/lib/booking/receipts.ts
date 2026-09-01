"use server";

import { withTenant } from "@/lib/tenant/withTenant";
import { resolveTenant } from "@/lib/tenant/resolve";
import { getCurrentCustomer } from "@/lib/auth/customerAuth";
import { storeReceipt } from "@/lib/storage/receipts";
import { notifyPaymentSubmitted } from "@/lib/email/notifications";
import { createNotification } from "@/lib/notifications/store";

/** Matches v2's uploadCustomerReceipt: the signed-in customer uploads proof
 * of payment for their own booking group; flips paymentStatus to
 * awaiting_verification, which extends the hold window (sweepLapsedBookings
 * treats awaiting_verification with the longer receiptReviewHoldMinutes,
 * not the shorter reservationHoldMinutes — an uploaded receipt buys the
 * customer time for staff to actually look at it). */
export async function uploadReceiptAction(bookingGroupId: string, fileBytes: ArrayBuffer, mimeType: string) {
  const tenant = await resolveTenant();
  const customer = await getCurrentCustomer();
  if (!customer) return { ok: false as const, error: "Your session expired. Please sign in again." };

  try {
    const stored = await storeReceipt(Buffer.from(fileBytes), mimeType);

    await withTenant(tenant.id, async (tx) => {
      const group = await tx.bookingGroup.findUnique({ where: { id: bookingGroupId } });
      if (!group || group.customerId !== customer.id) throw new Error("Booking not found.");

      // Replace any prior receipt for this group — re-uploading is a "change",
      // not a second attachment (the customer fixing a wrong photo).
      await tx.receipt.deleteMany({ where: { tenantId: tenant.id, bookingGroupId } });

      await tx.receipt.create({
        data: {
          tenantId: tenant.id,
          bookingGroupId,
          objectKey: stored.objectKey,
          mimeType,
          bytes: fileBytes.byteLength,
          data: stored.data ? new Uint8Array(stored.data) : null,
          uploadedByUserId: customer.userId,
        },
      });

      if (group.paymentStatus === "unpaid") {
        await tx.bookingGroup.update({ where: { id: bookingGroupId }, data: { paymentStatus: "awaiting_verification" } });
      }
      // In-app notifications: alert staff, acknowledge to the customer.
      const ref = group.reference ?? "your booking";
      await createNotification(tx, tenant.id, { audience: "staff", type: "payment_received", bookingGroupId, title: "Payment submitted", body: `${ref} has a payment awaiting verification.` });
      await createNotification(tx, tenant.id, { audience: "customer", customerId: group.customerId, type: "payment_awaiting", bookingGroupId, title: "Payment received", body: `We received your payment for ${ref} — pending verification.` });
    });

    // Notify staff that a payment was submitted (best-effort; never blocks the
    // upload). Gated by the Admin Receipt Alert toggle + recipient list.
    await notifyPaymentSubmitted(tenant.id, bookingGroupId);

    return { ok: true as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { ok: false as const, error: message };
  }
}

/** Customer removes their own just-uploaded receipt (a mistake fix). Reverts the
 * booking to Unpaid if it was only Awaiting Verification because of this upload.
 * Blocked once staff have actually confirmed the payment. */
export async function removeReceiptAction(bookingGroupId: string) {
  const tenant = await resolveTenant();
  const customer = await getCurrentCustomer();
  if (!customer) return { ok: false as const, error: "Your session expired. Please sign in again." };

  try {
    await withTenant(tenant.id, async (tx) => {
      const group = await tx.bookingGroup.findUnique({ where: { id: bookingGroupId } });
      if (!group || group.customerId !== customer.id) throw new Error("Booking not found.");
      if (group.paymentStatus === "paid") throw new Error("Payment has already been confirmed — contact the court managers to make changes.");

      await tx.receipt.deleteMany({ where: { tenantId: tenant.id, bookingGroupId } });
      if (group.paymentStatus === "awaiting_verification") {
        await tx.bookingGroup.update({ where: { id: bookingGroupId }, data: { paymentStatus: "unpaid" } });
      }
    });
    return { ok: true as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { ok: false as const, error: message };
  }
}
