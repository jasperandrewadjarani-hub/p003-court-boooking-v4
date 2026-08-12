import { withTenant } from "@/lib/tenant/withTenant";
import { getBookingRules } from "@/lib/booking/availability";
import { sweepLapsedBookings } from "@/lib/booking/expiry";

export type DispatchTileState = "vacant" | "paid" | "unpaid" | "blocked";

export interface DispatchTile {
  start: string;
  end: string;
  state: DispatchTileState;
  courtId: string;
  booking?: {
    reference: string | null;
    customerName: string;
    paymentStatus: string;
    status: string;
    totalMinor: number;
  };
}

export interface DispatchCourt {
  courtId: string;
  courtName: string;
  description: string | null;
  slots: DispatchTile[];
}

export interface DispatchGridData {
  date: string;
  slotMinutes: number;
  courts: DispatchCourt[];
}

const ACTIVE_STATUSES = ["reserved", "confirmed", "checked_in", "playing"] as const;

/** Admin's live schedule view — matches v2's adminGetCourtGrid, but sourced
 * directly from Postgres instead of a 30s script-cache layer (a single
 * indexed query here is already fast enough not to need one). */
export async function getDispatchGrid(tenantId: string, dateKey: string): Promise<DispatchGridData> {
  const rules = await getBookingRules(tenantId);

  return withTenant(tenantId, async (tx) => {
    await sweepLapsedBookings(tx, tenantId, rules);

    const courts = await tx.court.findMany({ where: { tenantId, status: { not: "closed" } }, orderBy: { sortOrder: "asc" } });

    const dayBookings = await tx.booking.findMany({
      where: { tenantId, localDate: new Date(dateKey + "T00:00:00.000Z"), status: { in: [...ACTIVE_STATUSES] as any } },
      include: { bookingGroup: { include: { customer: true } } },
    });

    const openMin = rules.openHour * 60;
    const closeMin = rules.closeHour * 60;
    const slotMin = rules.slotMinutes;

    const dispatchCourts: DispatchCourt[] = courts.map((court) => {
      const slots: DispatchTile[] = [];
      for (let m = openMin; m < closeMin; m += slotMin) {
        const slotStart = m;
        const slotEnd = m + slotMin;
        const label = { start: minutesToTimeStr(slotStart), end: minutesToTimeStr(slotEnd) };

        if (court.status === "maintenance") {
          slots.push({ ...label, state: "blocked", courtId: court.id });
          continue;
        }

        const match = dayBookings.find((b) => {
          if (b.courtId !== court.id) return false;
          const bStart = toMinutes(formatUtcTime(b.startsAt));
          const bEnd = toMinutes(formatUtcTime(b.endsAt)) + b.turnoverBufferMinutes;
          return slotStart < bEnd && slotEnd > bStart;
        });

        if (!match) {
          slots.push({ ...label, state: "vacant", courtId: court.id });
          continue;
        }

        const isPaid = match.bookingGroup.paymentStatus === "paid";
        slots.push({
          ...label,
          state: isPaid ? "paid" : "unpaid",
          courtId: court.id,
          booking: {
            reference: match.bookingGroup.reference,
            customerName: `${match.bookingGroup.customer.firstName} ${match.bookingGroup.customer.lastName}`.trim(),
            paymentStatus: match.bookingGroup.paymentStatus,
            status: match.bookingGroup.status,
            totalMinor: match.bookingGroup.totalMinor,
          },
        });
      }
      return { courtId: court.id, courtName: court.name, description: court.description, slots };
    });

    return { date: dateKey, slotMinutes: slotMin, courts: dispatchCourts };
  });
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTimeStr(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatUtcTime(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
