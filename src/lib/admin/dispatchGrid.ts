import { withTenant } from "@/lib/tenant/withTenant";
import { getBookingRules, gridWindowMinutes } from "@/lib/booking/availability";
import { sweepLapsedBookings } from "@/lib/booking/expiry";

// "maintenance" = the court itself is marked out of service (Court.status).
// "blocked" = an admin-created BlockedSlot row for this specific date/time —
// distinct concepts in v3b (BlockedSlotService vs. Court status), rendered
// with distinct tile states here too.
export type DispatchTileState = "vacant" | "paid" | "unpaid" | "blocked" | "maintenance";

export interface DispatchTile {
  start: string;
  end: string;
  state: DispatchTileState;
  courtId: string;
  booking?: {
    id: string;
    reference: string | null;
    customerName: string;
    paymentStatus: string;
    status: string;
    totalMinor: number;
  };
  // Present only when state === "blocked" — lets the UI offer an "Unblock"
  // action against the specific BlockedSlot row(s) covering this tile.
  block?: {
    id: string;
    reason: string | null;
  };
}

export interface DispatchCourt {
  courtId: string;
  courtName: string;
  description: string | null;
  headerColor: string | null;
  slots: DispatchTile[];
}

export interface DispatchGridData {
  date: string;
  slotMinutes: number;
  // Customer-facing booking window (minutes-from-midnight), distinct from the
  // admin grid's own full-day window — lets the UI offer a client-side
  // "Customer hours" crop toggle without a second fetch.
  customerWindow: { startMin: number; endMin: number };
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

    const dayDate = new Date(dateKey + "T00:00:00.000Z");
    const dayBookings = await tx.booking.findMany({
      where: { tenantId, localDate: dayDate, status: { in: [...ACTIVE_STATUSES] as any } },
      include: { bookingGroup: { include: { customer: true } } },
    });
    // Admin-created blocked slots — v3b renders these as a distinct "Blocked"
    // tile state, separate from a court's own "maintenance" status.
    const dayBlocks = await tx.blockedSlot.findMany({
      where: { tenantId, localDate: dayDate },
    });

    // Admin dispatch uses the ADMIN grid window (v3b live: 00:00-00:00 = full
    // 24h), not the customer-facing window.
    const [openMin, closeMin] = gridWindowMinutes(rules.adminGridStartTime, rules.adminGridEndTime);
    const slotMin = rules.slotMinutes;

    const dispatchCourts: DispatchCourt[] = courts.map((court) => {
      const slots: DispatchTile[] = [];
      for (let m = openMin; m < closeMin; m += slotMin) {
        const slotStart = m;
        const slotEnd = m + slotMin;
        const label = { start: minutesToTimeStr(slotStart), end: minutesToTimeStr(slotEnd) };

        if (court.status === "maintenance") {
          slots.push({ ...label, state: "maintenance", courtId: court.id });
          continue;
        }

        const block = dayBlocks.find((b) => {
          if (b.courtId !== court.id) return false;
          const bStart = toMinutes(formatUtcTime(b.startsAt));
          const bEnd = toMinutes(formatUtcTime(b.endsAt));
          return slotStart < bEnd && slotEnd > bStart;
        });
        if (block) {
          slots.push({ ...label, state: "blocked", courtId: court.id, block: { id: block.id, reason: block.reason } });
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
            id: match.bookingGroup.id,
            reference: match.bookingGroup.reference,
            customerName: `${match.bookingGroup.customer.firstName} ${match.bookingGroup.customer.lastName}`.trim(),
            paymentStatus: match.bookingGroup.paymentStatus,
            status: match.bookingGroup.status,
            totalMinor: match.bookingGroup.totalMinor,
          },
        });
      }
      return { courtId: court.id, courtName: court.name, description: court.description, headerColor: court.headerColor, slots };
    });

    const [custStart, custEnd] = gridWindowMinutes(rules.customerGridStartTime, rules.customerGridEndTime);
    return {
      date: dateKey,
      slotMinutes: slotMin,
      customerWindow: { startMin: custStart, endMin: custEnd },
      courts: dispatchCourts,
    };
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
