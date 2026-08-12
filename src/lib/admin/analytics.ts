import { withTenant } from "@/lib/tenant/withTenant";

export interface AnalyticsData {
  totalBookings: number;
  totalCancelled: number;
  totalLapsed: number;
  totalRevenueMinor: number;
  avgValueMinor: number;
  cancellationRatePercent: number;
  revenueOverTime: { date: string; revenueMinor: number }[];
  bookingsByStatus: { status: string; count: number }[];
  bookingsByCourt: { courtName: string; count: number }[];
  bookingsByHour: { hour: number; count: number }[];
}

/** Matches v2's adminGetAnalytics — a date-ranged summary plus the four
 * chart datasets the Analytics tab renders. */
export async function getAnalytics(tenantId: string, dateFrom: string, dateTo: string): Promise<AnalyticsData> {
  return withTenant(tenantId, async (tx) => {
    const groups = await tx.bookingGroup.findMany({
      where: { tenantId, createdAt: { gte: new Date(dateFrom + "T00:00:00.000Z"), lt: new Date(dateTo + "T23:59:59.999Z") } },
      include: { bookings: { include: { court: true } } },
    });

    const totalBookings = groups.length;
    const totalCancelled = groups.filter((g) => g.status === "cancelled").length;
    const totalLapsed = groups.filter((g) => g.status === "lapsed").length;
    const revenueGroups = groups.filter((g) => !["cancelled", "lapsed", "no_show"].includes(g.status));
    const totalRevenueMinor = revenueGroups.reduce((sum, g) => sum + g.amountPaidMinor, 0);
    const avgValueMinor = revenueGroups.length ? Math.round(totalRevenueMinor / revenueGroups.length) : 0;
    const cancellationRatePercent = totalBookings ? Math.round((totalCancelled / totalBookings) * 1000) / 10 : 0;

    const byDate = new Map<string, number>();
    const byStatus = new Map<string, number>();
    const byCourt = new Map<string, number>();
    const byHour = new Map<number, number>();

    for (const g of groups) {
      const dateKey = g.createdAt.toISOString().slice(0, 10);
      byDate.set(dateKey, (byDate.get(dateKey) ?? 0) + g.amountPaidMinor);
      byStatus.set(g.status, (byStatus.get(g.status) ?? 0) + 1);
      for (const b of g.bookings) {
        byCourt.set(b.court.name, (byCourt.get(b.court.name) ?? 0) + 1);
        const hour = b.startsAt.getUTCHours();
        byHour.set(hour, (byHour.get(hour) ?? 0) + 1);
      }
    }

    return {
      totalBookings,
      totalCancelled,
      totalLapsed,
      totalRevenueMinor,
      avgValueMinor,
      cancellationRatePercent,
      revenueOverTime: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, revenueMinor]) => ({ date, revenueMinor })),
      bookingsByStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
      bookingsByCourt: [...byCourt.entries()].map(([courtName, count]) => ({ courtName, count })),
      bookingsByHour: [...byHour.entries()].sort(([a], [b]) => a - b).map(([hour, count]) => ({ hour, count })),
    };
  });
}
