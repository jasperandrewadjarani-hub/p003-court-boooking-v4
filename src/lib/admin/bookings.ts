import { withTenant } from "@/lib/tenant/withTenant";
import { getBookingRules } from "@/lib/booking/availability";
import { sweepLapsedBookings } from "@/lib/booking/expiry";
import { compileSlots } from "@/lib/format";

export interface BookingFilters {
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  search?: string;
  page?: number; // 1-based
  pageSize?: number;
}

export interface PagedBookings {
  items: AdminBookingGroup[];
  totalCount: number;
  page: number;
  pageSize: number;
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
  receiptId: string | null;
}

/** Matches v2's adminListBookings — date range, status, and a name/phone/
 * reference search, paged (default 20/page) so the full 3,000+-row table
 * doesn't get silently capped/truncated — was a flat take:300 with no way
 * to see anything beyond that (client-reported: "there are 3.6k+ bookings
 * ... but not all appear"). */
export async function listBookings(tenantId: string, filters: BookingFilters): Promise<PagedBookings> {
  const rules = await getBookingRules(tenantId);
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));

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

    const [totalCount, groups] = await Promise.all([
      tx.bookingGroup.count({ where }),
      tx.bookingGroup.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { include: { user: true } },
          bookings: { include: { court: true }, orderBy: { startsAt: "asc" } },
          receipts: { select: { id: true }, orderBy: { uploadedAt: "desc" }, take: 1 },
        },
      }),
    ]);

    return { items: groups.map(mapAdminGroup), totalCount, page, pageSize };
  });
}

// Shared mapper so the dispatch-grid single-fetch and the list stay identical.
function mapAdminGroup(g: any): AdminBookingGroup {
  return {
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
    items: compileSlots(g.bookings.map((b: any) => ({ courtName: b.court.name, start: formatUtcTime(b.startsAt), end: formatUtcTime(b.endsAt), priceMinor: b.priceMinor }))),
    receiptId: g.receipts?.[0]?.id ?? null,
  };
}

/** Single booking group by id — used by the dispatch grid to open the ops
 *  modal when an admin clicks an occupied block. */
export async function getBookingGroupById(tenantId: string, id: string): Promise<AdminBookingGroup | null> {
  return withTenant(tenantId, async (tx) => {
    const g = await tx.bookingGroup.findFirst({
      where: { tenantId, id },
      include: {
        customer: { include: { user: true } },
        bookings: { include: { court: true }, orderBy: { startsAt: "asc" } },
        receipts: { select: { id: true }, orderBy: { uploadedAt: "desc" }, take: 1 },
      },
    });
    return g ? mapAdminGroup(g) : null;
  });
}

function formatUtcTime(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
