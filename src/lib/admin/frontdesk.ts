"use server";

import { withTenant } from "@/lib/tenant/withTenant";
import { resolveTenant } from "@/lib/tenant/resolve";
import { requireStaff } from "@/lib/auth/staffAuth";
import { createBooking, SlotTakenError, type CartItemInput } from "@/lib/booking/create";
import { recordPayment } from "@/lib/admin/payments";

export interface FrontdeskBookingInput {
  items: CartItemInput[];
  dateKey: string;
  players: number; // v3b removed Number of Players from the front-desk form too — accepted for payload-shape compat but never stored (createBooking always writes 1)
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  notes?: string;
  membershipType?: string;
  discountCode?: string;
  // Optional immediate payment collection, matching v3b's
  // adminCreateFrontdeskBooking optional-payment support — recorded right
  // after the booking is created, so front desk doesn't need a second trip
  // to the Bookings tab just to take cash at the counter.
  amountPaidMinor?: number;
  paymentMethod?: "cash" | "gcash" | "maya" | "credit_card" | "bank_transfer" | "gotyme";
}

/**
 * Walk-in booking creation from the Dispatch Grid's multi-select — matches
 * v2's adminCreateFrontdeskBooking: staff authentication replaces customer
 * OTP entirely, and the staff-provided contact info is trusted directly
 * (find-or-create by email) since there's no customer session to defer to.
 */
export async function createFrontdeskBookingAction(input: FrontdeskBookingInput) {
  const tenant = await resolveTenant();
  const staff = await requireStaff();

  try {
    const normalizedEmail = (input.email || `walkin-${Date.now()}@no-email.local`).trim().toLowerCase();

    const customer = await withTenant(tenant.id, async (tx) => {
      const existingUser = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE tenant_id = ${tenant.id}::uuid AND lower(email) = ${normalizedEmail} LIMIT 1
      `;
      if (existingUser.length) {
        const existingCustomer = await tx.customer.findUnique({ where: { userId: existingUser[0].id } });
        if (existingCustomer) return existingCustomer;
      }
      const user = await tx.user.create({ data: { tenantId: tenant.id, kind: "customer", email: normalizedEmail } });
      return tx.customer.create({
        data: { tenantId: tenant.id, userId: user.id, firstName: input.firstName, lastName: input.lastName, mobileNumber: input.phone },
      });
    });

    const result = await createBooking({
      tenantId: tenant.id,
      dateKey: input.dateKey,
      items: input.items,
      players: input.players,
      customerId: customer.id,
      membershipType: input.membershipType,
      discountCode: input.discountCode,
      source: "staff",
      staffUserId: staff.userId,
      notes: input.notes,
    });

    // Optional immediate payment — a separate withTenant transaction (same
    // recordPayment used by the admin Bookings tab), run only after the
    // booking has actually committed. recordPayment itself rejects
    // amounts that would overpay the booking's total.
    let payment: Awaited<ReturnType<typeof recordPayment>> | undefined;
    if (input.amountPaidMinor && input.amountPaidMinor > 0) {
      payment = await withTenant(tenant.id, (tx) =>
        recordPayment(tx, {
          tenantId: tenant.id,
          bookingGroupId: result.bookingGroupId,
          method: input.paymentMethod ?? "cash",
          amountMinor: input.amountPaidMinor!,
          staffUserId: staff.userId,
        })
      );
    }

    return { ok: true as const, result, payment };
  } catch (err) {
    if (err instanceof SlotTakenError) return { ok: false as const, error: err.message };
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { ok: false as const, error: message };
  }
}
