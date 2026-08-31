"use server";

import { resolveTenant } from "@/lib/tenant/resolve";
import { getAvailabilityGrid, getBookingRules } from "@/lib/booking/availability";
import { createBooking, priceCart, SlotTakenError, type CartItemInput } from "@/lib/booking/create";
import { releaseDiscount, discountCountsForStatus } from "@/lib/booking/discounts";
import { getCurrentCustomer } from "@/lib/auth/customerAuth";
import { getMyBookings } from "@/lib/booking/customerBookings";
import { getPaymentQrImages } from "@/lib/booking/paymentSettings";
import { withTenant } from "@/lib/tenant/withTenant";

export async function fetchGridAction(dateKey: string) {
  const tenant = await resolveTenant();
  const grid = await getAvailabilityGrid(tenant.id, dateKey);
  return grid;
}

/** On-demand fetch of the tenant's payment QR images — called by the success
 * modal AFTER a booking, so the ~800 KB of QR data-URIs never load on the
 * customer's initial page render. */
export async function fetchPaymentQrImagesAction() {
  const tenant = await resolveTenant();
  return getPaymentQrImages(tenant.id);
}

/** Live pre-checkout total preview — same calculateCartTotal call the real
 * booking transaction uses (src/lib/booking/create.ts's priceCart), so the
 * preview shown while building a cart can never drift from what's charged.
 * An invalid/exhausted discountCode doesn't fail the whole preview — it
 * falls back to the undiscounted total and surfaces `discountError` so the
 * UI can show why the code didn't apply, without blocking the customer from
 * seeing a total at all. */
export async function previewCartTotalAction(dateKey: string, items: CartItemInput[], membershipType?: string, discountCode?: string) {
  if (!items.length) return { totalMinor: 0, discountMinor: 0 };
  const tenant = await resolveTenant();
  try {
    const rules = await getBookingRules(tenant.id);
    if (discountCode) {
      try {
        const { cart } = await priceCart(tenant.id, dateKey, items, membershipType, rules.taxRatePercent, discountCode);
        return { totalMinor: cart.totalMinor, discountMinor: cart.discountMinor };
      } catch (err) {
        const discountError = err instanceof Error ? err.message : "Invalid discount code.";
        const { cart } = await priceCart(tenant.id, dateKey, items, membershipType, rules.taxRatePercent);
        return { totalMinor: cart.totalMinor, discountMinor: cart.discountMinor, discountError };
      }
    }
    const { cart } = await priceCart(tenant.id, dateKey, items, membershipType, rules.taxRatePercent);
    return { totalMinor: cart.totalMinor, discountMinor: cart.discountMinor };
  } catch (err) {
    return { totalMinor: 0, discountMinor: 0, discountError: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function createBookingAction(input: {
  dateKey: string;
  items: CartItemInput[];
  players: number;
  membershipType?: string;
  discountCode?: string;
}) {
  const tenant = await resolveTenant();
  const customer = await getCurrentCustomer();
  if (!customer) {
    return { ok: false as const, error: "Your session expired. Please sign in again." };
  }
  try {
    const result = await createBooking({ tenantId: tenant.id, customerId: customer.id, ...input });
    return { ok: true as const, result };
  } catch (err) {
    if (err instanceof SlotTakenError) {
      return { ok: false as const, error: err.message };
    }
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { ok: false as const, error: message };
  }
}

/** Returns null if not signed in (caller shows the login/lookup panel instead of a list). */
export async function fetchMyBookingsAction() {
  const tenant = await resolveTenant();
  return getMyBookings(tenant.id);
}

const CANCELLABLE_STATUSES = ["reserved", "confirmed"] as const;

/** Self-cancel — only Reserved/Confirmed groups belonging to the signed-in
 * customer, matching v2's customer cancellation rule. */
export async function cancelMyBookingAction(bookingGroupId: string) {
  const tenant = await resolveTenant();
  const customer = await getCurrentCustomer();
  if (!customer) return { ok: false as const, error: "Your session expired. Please sign in again." };

  try {
    await withTenant(tenant.id, async (tx) => {
      const group = await tx.bookingGroup.findUnique({ where: { id: bookingGroupId } });
      if (!group || group.customerId !== customer.id) throw new Error("Booking not found.");
      if (!CANCELLABLE_STATUSES.includes(group.status as (typeof CANCELLABLE_STATUSES)[number])) {
        throw new Error("This booking can no longer be cancelled.");
      }
      await tx.bookingGroup.update({ where: { id: bookingGroupId }, data: { status: "cancelled" } });
      await tx.booking.updateMany({ where: { bookingGroupId }, data: { status: "cancelled" } });
      // A cancelled booking releases its discount (availment + budget) back.
      if (group.discountId && discountCountsForStatus(group.status)) {
        await releaseDiscount(tx, tenant.id, group.discountId, group.discountAmountMinor);
      }
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: customer.userId,
          actorKind: "customer",
          entity: "booking_group",
          entityId: bookingGroupId,
          action: "CANCEL",
          details: {},
        },
      });
    });
    return { ok: true as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { ok: false as const, error: message };
  }
}
