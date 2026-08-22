import { withTenant } from "@/lib/tenant/withTenant";
import { getBookingRules } from "@/lib/booking/availability";
import { sweepLapsedBookings } from "@/lib/booking/expiry";

export interface DashboardStats {
  todayBookings: number;
  todayCancelled: number;
  todayLapsed: number;
  revenueToday: number; // minor units
  bookedValueToday: number;
  activeNow: number;
  totalCustomers: number;
}

const REVENUE_EXCLUDED_STATUSES = ["cancelled", "lapsed", "no_show"];

export async function getDashboardStats(tenantId: string): Promise<DashboardStats> {
  const rules = await getBookingRules(tenantId);

  return withTenant(tenantId, async (tx) => {
    await sweepLapsedBookings(tx, tenantId, rules);

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

    const todayGroups = await tx.bookingGroup.findMany({
      where: { tenantId, createdAt: { gte: todayStart, lt: todayEnd } },
      select: { status: true, totalMinor: true, amountPaidMinor: true },
    });

    const activeNow = await tx.booking.count({
      where: { tenantId, status: { in: ["checked_in", "playing"] } },
    });

    const totalCustomers = await tx.customer.count({ where: { tenantId } });

    const revenueGroups = todayGroups.filter((g) => !REVENUE_EXCLUDED_STATUSES.includes(g.status));

    return {
      todayBookings: todayGroups.length,
      todayCancelled: todayGroups.filter((g) => g.status === "cancelled").length,
      todayLapsed: todayGroups.filter((g) => g.status === "lapsed").length,
      revenueToday: revenueGroups.reduce((sum, g) => sum + Math.min(g.totalMinor, g.amountPaidMinor), 0),
      bookedValueToday: revenueGroups.reduce((sum, g) => sum + g.totalMinor, 0),
      activeNow,
      totalCustomers,
    };
  });
}

export interface RecentBookingItem {
  courtName: string;
  start: string;
  end: string;
}

export interface RecentBooking {
  id: string;
  reference: string | null;
  customerName: string;
  status: string;
  paymentStatus: string;
  totalMinor: number;
  items: RecentBookingItem[];
}

export async function getRecentBookings(tenantId: string, take = 8): Promise<RecentBooking[]> {
  return withTenant(tenantId, async (tx) => {
    const groups = await tx.bookingGroup.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take,
      include: {
        customer: true,
        bookings: { include: { court: { omit: { imageUrl: true } } }, orderBy: { startsAt: "asc" } },
      },
    });

    return groups.map((g) => ({
      id: g.id,
      reference: g.reference,
      customerName: `${g.customer.firstName} ${g.customer.lastName}`.trim(),
      status: g.status,
      paymentStatus: g.paymentStatus,
      totalMinor: g.totalMinor,
      items: g.bookings.map((b) => ({ courtName: b.court.name, start: formatUtcTime(b.startsAt), end: formatUtcTime(b.endsAt) })),
    }));
  });
}

function formatUtcTime(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
