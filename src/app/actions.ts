"use server";

import { resolveTenant } from "@/lib/tenant/resolve";
import { getAvailabilityGrid } from "@/lib/booking/availability";
import { createBooking, SlotTakenError } from "@/lib/booking/create";

export async function fetchGridAction(dateKey: string) {
  const tenant = await resolveTenant();
  const grid = await getAvailabilityGrid(tenant.id, dateKey);
  return grid;
}

export async function createBookingAction(input: {
  dateKey: string;
  courtId: string;
  startTime: string;
  endTime: string;
  players: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
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
