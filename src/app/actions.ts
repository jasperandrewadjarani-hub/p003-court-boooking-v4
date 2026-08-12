"use server";

import { resolveTenant } from "@/lib/tenant/resolve";
import { getAvailabilityGrid } from "@/lib/booking/availability";
import { createBooking, priceCart, SlotTakenError, type CartItemInput } from "@/lib/booking/create";

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
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  membershipType?: string;
}) {
  const tenant = await resolveTenant();
  try {
    const result = await createBooking({ tenantId: tenant.id, ...input });
    return { ok: true as const, result };
  } catch (err) {
    if (err instanceof SlotTakenError) {
      return { ok: false as const, error: err.message };
    }
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { ok: false as const, error: message };
  }
}
