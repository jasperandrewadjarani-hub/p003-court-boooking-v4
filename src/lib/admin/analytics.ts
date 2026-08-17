import { withTenant } from "@/lib/tenant/withTenant";

export interface AnalyticsData {
  totalBookings: number;
  confirmedReservedCount: number;
  cancelledCount: number;
  lapsedCount: number;
  totalRevenueMinor: number;
  avgValueMinor: number;
  cancellationRatePercent: number;
  revenueOverTime: { date: string; revenueMinor: number }[];
  bookingsByStatus: { status: string; count: number }[];
  bookingsByCourt: { courtName: string; count: number }[];
  bookingsByHour: { hour: number; count: number }[];
  dailyBookingsByStatus: { date: string; statuses: Record<string, number> }[];
}

/** Groups in these statuses never count toward Bookings-by-Court / Bookings-by-Hour
 * (v3b's `operationalRows` filter in `AdminAnalytics.js`). */
const EXCLUDED_FROM_OPERATIONAL = new Set(["cancelled", "lapsed", "no_show"]);

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function enumerateDateKeys(fromKey: string, toKey: string): string[] {
  const keys: string[] = [];
  let cur = new Date(fromKey + "T00:00:00.000Z");
  const end = new Date(toKey + "T00:00:00.000Z");
  while (cur.getTime() <= end.getTime()) {
    keys.push(dateKey(cur));
    cur = new Date(cur.getTime() + 86400000);
  }
  return keys;
}

/** A group's "booking date" = the earliest `Booking.localDate` among its items,
 * falling back to `Booking.startsAt` (if `localDate` is somehow unset) and
 * finally to the group's `createdAt` date when it has no items at all.
 * Matches v3b's booking-date derivation used for every count-based metric. */
export function deriveBookingDate(bookings: { localDate: Date | null; startsAt: Date }[], createdAt: Date): Date {
  if (bookings.length === 0) return createdAt;
  let earliest: Date | null = null;
  for (const b of bookings) {
    const d = b.localDate ?? b.startsAt;
    if (!earliest || d < earliest) earliest = d;
  }
  return earliest!;
}

/**
 * Matches v3b's `buildAdminAnalytics_` (`AdminAnalytics.js`), confirmed
 * against screenshot `admin-app/Screenshot 2026-08-17 162122.png`.
 *
 * Deliberate MIXED date-basis, preserved from v3b (not a bug):
 *  - Booking counts, status breakdowns, avg value, and the stacked daily
 *    chart are all bucketed by each group's derived BOOKING date.
 *  - Revenue (`totalRevenueMinor`, `revenueOverTime`) is bucketed by each
 *    Payment's own `collectedAt` date — the date the money was actually
 *    collected, independent of when the booking itself happened. This
 *    mirrors v3b's `applyPaymentAggregateDeltas_`, which writes a separate
 *    Aggregates row keyed by the payment's own date whenever it differs
 *    from the booking's date.
 */
export async function getAnalytics(tenantId: string, dateFrom: string, dateTo: string): Promise<AnalyticsData> {
  return withTenant(tenantId, async (tx) => {
    const rangeStart = new Date(dateFrom + "T00:00:00.000Z");
    const rangeEndExclusive = new Date(dateTo + "T23:59:59.999Z");
    const dateFromDate = new Date(dateFrom + "T00:00:00.000Z");
    const dateToDate = new Date(dateTo + "T00:00:00.000Z");

    // Generous fetch: any group with an item whose localDate falls in the
    // window, plus itemless groups selected by createdAt as a fallback.
    // Precise inclusion is re-checked in JS below against each group's
    // derived booking date (see deriveBookingDate).
    const candidateGroups = await tx.bookingGroup.findMany({
      where: {
        tenantId,
        OR: [
          { bookings: { some: { localDate: { gte: dateFromDate, lte: dateToDate } } } },
          { bookings: { none: {} }, createdAt: { gte: rangeStart, lt: rangeEndExclusive } },
        ],
      },
      include: { bookings: { include: { court: true } } },
    });

    const groupsInRange = candidateGroups
      .map((g) => ({ group: g, bookingDate: dateKey(deriveBookingDate(g.bookings, g.createdAt)) }))
      .filter(({ bookingDate }) => bookingDate >= dateFrom && bookingDate <= dateTo);

    const totalBookings = groupsInRange.length;
    const confirmedReservedCount = groupsInRange.filter(({ group }) => group.status === "confirmed" || group.status === "reserved").length;
    const cancelledCount = groupsInRange.filter(({ group }) => group.status === "cancelled").length;
    const lapsedCount = groupsInRange.filter(({ group }) => group.status === "lapsed").length;
    const cancellationRatePercent = totalBookings ? Math.round((cancelledCount / totalBookings) * 1000) / 10 : 0;

    const operational = groupsInRange.filter(({ group }) => !EXCLUDED_FROM_OPERATIONAL.has(group.status));
    const avgValueMinor = operational.length
      ? Math.round(operational.reduce((sum, { group }) => sum + group.totalMinor, 0) / operational.length)
      : 0;

    const byStatus = new Map<string, number>();
    for (const { group } of groupsInRange) byStatus.set(group.status, (byStatus.get(group.status) ?? 0) + 1);

    // Bookings by Court / by Hour: excluded statuses filtered out, and each
    // group counts at most once per court / once per hour it touches — not
    // once per booking row (a group with 2 items on the same court counts
    // once for that court).
    const byCourt = new Map<string, number>();
    const byHour = new Map<number, number>();
    for (const { group } of operational) {
      const courtsSeen = new Set<string>();
      const hoursSeen = new Set<number>();
      for (const b of group.bookings) {
        courtsSeen.add(b.court.name);
        hoursSeen.add(b.startsAt.getUTCHours());
      }
      for (const courtName of courtsSeen) byCourt.set(courtName, (byCourt.get(courtName) ?? 0) + 1);
      for (const hour of hoursSeen) byHour.set(hour, (byHour.get(hour) ?? 0) + 1);
    }

    // One entry per date in the requested range (even zero-count dates) —
    // feeds the Bookings Over Time stacked chart.
    const dailyStatusMap = new Map<string, Record<string, number>>();
    for (const dk of enumerateDateKeys(dateFrom, dateTo)) dailyStatusMap.set(dk, {});
    for (const { group, bookingDate } of groupsInRange) {
      const bucket = dailyStatusMap.get(bookingDate);
      if (!bucket) continue;
      bucket[group.status] = (bucket[group.status] ?? 0) + 1;
    }

    // Payment-collection-date basis — independent query, independent of the
    // booking-date groups above.
    const payments = await tx.payment.findMany({
      where: { tenantId, collectedAt: { gte: rangeStart, lt: rangeEndExclusive } },
    });
    const totalRevenueMinor = payments.reduce((sum, p) => sum + p.amountMinor, 0);
    const byPaymentDate = new Map<string, number>();
    for (const p of payments) {
      const dk = dateKey(p.collectedAt);
      byPaymentDate.set(dk, (byPaymentDate.get(dk) ?? 0) + p.amountMinor);
    }

    return {
      totalBookings,
      confirmedReservedCount,
      cancelledCount,
      lapsedCount,
      totalRevenueMinor,
      avgValueMinor,
      cancellationRatePercent,
      revenueOverTime: [...byPaymentDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, revenueMinor]) => ({ date, revenueMinor })),
      bookingsByStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
      bookingsByCourt: [...byCourt.entries()].map(([courtName, count]) => ({ courtName, count })),
      bookingsByHour: [...byHour.entries()].sort(([a], [b]) => a - b).map(([hour, count]) => ({ hour, count })),
      dailyBookingsByStatus: enumerateDateKeys(dateFrom, dateTo).map((date) => ({ date, statuses: dailyStatusMap.get(date) ?? {} })),
    };
  });
}
