import { withTenant } from "@/lib/tenant/withTenant";
import { toMinutes, minutesToTimeStr } from "@/lib/pricing/calculate";

export interface BookingRulesSettings {
  openHour: number;
  closeHour: number;
  slotMinutes: number;
  turnoverBufferMinutes: number;
  maxAdvanceBookingDays: number;
  minBookingMinutes: number;
  maxBookingMinutes: number;
}

const DEFAULT_RULES: BookingRulesSettings = {
  openHour: 6,
  closeHour: 22,
  slotMinutes: 30,
  turnoverBufferMinutes: 10,
  maxAdvanceBookingDays: 30,
  minBookingMinutes: 30,
  maxBookingMinutes: 180,
};

export async function getBookingRules(tenantId: string): Promise<BookingRulesSettings> {
  return withTenant(tenantId, async (tx) => {
    const row = await tx.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key: "booking_rules" } },
    });
    return row ? { ...DEFAULT_RULES, ...(row.value as Partial<BookingRulesSettings>) } : DEFAULT_RULES;
  });
}

export interface GridSlot {
  start: string;
  end: string;
  status: "available" | "booked" | "maintenance";
}

export interface GridCourt {
  id: string;
  code: string;
  name: string;
  description: string | null;
  indoor: boolean;
  capacity: number;
  baseRateMinor: number | null;
  slots: GridSlot[];
}

export interface AvailabilityGrid {
  date: string;
  slotMinutes: number;
  courts: GridCourt[];
}

/** The active-booking statuses that occupy a slot — matches v2's
 *  activeBookingStatuses_() and the exclusion constraint's own predicate. */
const ACTIVE_STATUSES = ["reserved", "confirmed", "checked_in", "playing"] as const;

export async function getAvailabilityGrid(tenantId: string, dateKey: string): Promise<AvailabilityGrid> {
  const rules = await getBookingRules(tenantId);

  return withTenant(tenantId, async (tx) => {
    const courts = await tx.court.findMany({
      where: { tenantId, status: { not: "closed" } },
      orderBy: { sortOrder: "asc" },
    });

    // local_date is a DATE column (no time component) — exact equality,
    // not a range, is the correct comparison.
    const dayBookings = await tx.booking.findMany({
      where: {
        tenantId,
        localDate: new Date(dateKey + "T00:00:00.000Z"),
        status: { in: [...ACTIVE_STATUSES] as any },
      },
      select: { courtId: true, startsAt: true, endsAt: true, turnoverBufferMinutes: true },
    });

    const openMin = rules.openHour * 60;
    const closeMin = rules.closeHour * 60;
    const slotMin = rules.slotMinutes;

    const gridCourts: GridCourt[] = courts.map((court) => {
      const slots: GridSlot[] = [];
      for (let m = openMin; m < closeMin; m += slotMin) {
        const slotStart = m;
        const slotEnd = m + slotMin;
        let status: GridSlot["status"] = "available";
        if (court.status === "maintenance") {
          status = "maintenance";
        } else {
          const overlapping = dayBookings.some((b) => {
            if (b.courtId !== court.id) return false;
            const bStart = toMinutes(formatLocalTime(b.startsAt));
            const bEnd = toMinutes(formatLocalTime(b.endsAt)) + b.turnoverBufferMinutes;
            return slotStart < bEnd && slotEnd > bStart;
          });
          if (overlapping) status = "booked";
        }
        slots.push({ start: minutesToTimeStr(slotStart), end: minutesToTimeStr(slotEnd), status });
      }
      return {
        id: court.id,
        code: court.code,
        name: court.name,
        description: court.description,
        indoor: court.indoor,
        capacity: court.capacity,
        baseRateMinor: court.baseRateMinor,
        slots,
      };
    });

    return { date: dateKey, slotMinutes: slotMin, courts: gridCourts };
  });
}

// Bookings are stored as timestamptz (UTC). This client-facing slice
// intentionally uses UTC clock time as "local" time for now (matches the
// seed data's naive scheduling) — a real timezone-aware conversion using
// the tenant's tz is Phase 2 formal work, not this slice's scope.
function formatLocalTime(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
