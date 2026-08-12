import { withTenant } from "@/lib/tenant/withTenant";
import { getBookingRules } from "@/lib/booking/availability";
import { sweepLapsedBookings } from "@/lib/booking/expiry";

export interface BookingFilters {
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  search?: string;
}

export interface AdminBookingItem {
  courtName: string;
  start: string;
  end: string;
  priceMinor: number;
}

export interface AdminBookingGroup {
  id: string;
  reference: string | null;
  dateLabel: string;
  customerName: string;
  phone: string | null;
  email: string;
  status: string;
  paymentStatus: string;
  amountPaidMinor: number;
  totalMinor: number;
  notes: string | null;
  players: number;
  items: AdminBookingItem[];
}

/** Matches v2's adminListBookings — date range, status, and a name/phone/
 * reference search, capped at 300 grouped results (use date filters to go
 * further back). */
export async function listBookings(tenantId: string, filters: BookingFilters): Promise<AdminBookingGroup[]> {
  const rules = await getBookingRules(tenantId);

  return withTenant(tenantId, async (tx) => {
    await sweepLapsedBookings(tx, tenantId, rules);

    const where: any = { tenantId };
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom + "T00:00:00.000Z");
      if (filters.dateTo) where.createdAt.lt = new Date(filters.dateTo + "T23:59:59.999Z");
    }
    if (filters.status) where.status = filters.status;
    if (filters.search) {
      const q = filters.search;
      where.OR = [
        { reference: { contains: q, mode: "insensitive" } },
        { customer: { firstName: { contains: q, mode: "insensitive" } } },
        { customer: { lastName: { contains: q, mode: "insensitive" } } },
        { customer: { mobileNumber: { contains: q, mode: "insensitive" } } },
      ];
    }

    const groups = await tx.bookingGroup.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        customer: { include: { user: true } },
        bookings: { include: { court: true }, orderBy: { startsAt: "asc" } },
      },
    });

    return groups.map((g) => ({
      id: g.id,
      reference: g.reference,
      dateLabel: g.bookings[0]?.localDate?.toISOString().slice(0, 10) ?? "",
      customerName: `${g.customer.firstName} ${g.customer.lastName}`.trim(),
      phone: g.customer.mobileNumber,
      email: g.customer.user.email,
      status: g.status,
      paymentStatus: g.paymentStatus,
      amountPaidMinor: g.amountPaidMinor,
      totalMinor: g.totalMinor,
      notes: g.notes,
      players: g.bookings[0]?.players ?? 1,
      items: g.bookings.map((b) => ({ courtName: b.court.name, start: formatUtcTime(b.startsAt), end: formatUtcTime(b.endsAt), priceMinor: b.priceMinor })),
    }));
  });
}

function formatUtcTime(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
