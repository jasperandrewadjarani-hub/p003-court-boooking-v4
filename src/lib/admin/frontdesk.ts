"use server";

import { withTenant } from "@/lib/tenant/withTenant";
import { resolveTenant } from "@/lib/tenant/resolve";
import { requireStaff } from "@/lib/auth/staffAuth";
import { createBooking, SlotTakenError, type CartItemInput } from "@/lib/booking/create";

export interface FrontdeskBookingInput {
  items: CartItemInput[];
  dateKey: string;
  players: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  notes?: string;
  membershipType?: string;
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
      source: "staff",
      staffUserId: staff.userId,
      notes: input.notes,
    });

    return { ok: true as const, result };
  } catch (err) {
    if (err instanceof SlotTakenError) return { ok: false as const, error: err.message };
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { ok: false as const, error: message };
  }
}
