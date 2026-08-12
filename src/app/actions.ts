"use server";

import { resolveTenant } from "@/lib/tenant/resolve";
import { getAvailabilityGrid } from "@/lib/booking/availability";
import { createBooking, priceCart, SlotTakenError, type CartItemInput } from "@/lib/booking/create";
import { getCurrentCustomer } from "@/lib/auth/customerAuth";
import { getMyBookings } from "@/lib/booking/customerBookings";
import { withTenant } from "@/lib/tenant/withTenant";

export async function fetchGridAction(dateKey: string) {
  const tenant = await resolveTenant();
  const grid = await getAvailabilityGrid(tenant.id, dateKey);
  return grid;
}

/** Live pre-checkout total preview — same calculateCartTotal call the real
 * booking transaction uses (src/lib/booking/create.ts's priceCart), so the
 * preview shown while building a cart can never drift from what's charged. */
export async function previewCartTotalAction(dateKey: string, items: CartItemInput[], membershipType?: string) {
  if (!items.length) return { totalMinor: 0, discountMinor: 0 };
  const tenant = await resolveTenant();
  const { cart } = await priceCart(tenant.id, dateKey, items, membershipType);
  return { totalMinor: cart.totalMinor, discountMinor: cart.discountMinor };
}

export async function createBookingAction(input: {
  dateKey: string;
  items: CartItemInput[];
  players: number;
  membershipType?: string;
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
