import { withTenant } from "@/lib/tenant/withTenant";
import { getBookingRules } from "@/lib/booking/availability";
import { sweepLapsedBookings } from "@/lib/booking/expiry";
import { compileSlots } from "@/lib/format";
import { releaseDiscount, discountCountsForStatus } from "@/lib/booking/discounts";

/** PERMANENTLY deletes a booking group and everything under it — bookings and
 *  receipts cascade; payments are onDelete:Restrict so they're removed first.
 *  Releases the discount usage if the booking was still counting. Irreversible;
 *  the caller (deleteBookingGroupAction) gates this behind the super-admin
 *  password. */
export async function deleteBookingGroup(tenantId: string, id: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const group = await tx.bookingGroup.findFirst({ where: { tenantId, id }, select: { id: true, discountId: true, discountAmountMinor: true, status: true } });
    if (!group) throw new Error("Booking not found.");
    if (group.discountId && discountCountsForStatus(group.status)) {
      await releaseDiscount(tx, tenantId, group.discountId, group.discountAmountMinor);
    }
    await tx.payment.deleteMany({ where: { tenantId, bookingGroupId: id } });
    await tx.bookingGroup.delete({ where: { id } });
  });
}

export interface BookingFilters {
  dateFrom?: string;
  dateTo?: string;
  statuses?: string[]; // multi-select booking status
  paymentStatuses?: string[]; // multi-select payment status
  source?: string; // "customer" (web_app) | "admin" (staff/walk_in/phone)
  search?: string;
  // Filter by the promo code applied to the booking group. A specific code
  // matches that code exactly; the sentinel "__ANY__" matches any booking that
  // had ANY discount code applied. Empty/undefined = no discount filter.
  discountCode?: string;
  hideFuture?: boolean; // show only bookings whose play date is today or earlier
  sortBy?: SortField; // clickable-column sort
  sortDir?: "asc" | "desc";
  page?: number; // 1-based
  pageSize?: number;
}

export type SortField = "createdAt" | "customer" | "status" | "paymentStatus" | "amountPaid" | "total";

export const ANY_DISCOUNT = "__ANY__";

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
  source: string; // raw BookingSource — "web_app" = customer, else admin
  amountPaidMinor: number;
  totalMinor: number;
  notes: string | null;
  players: number;
  items: AdminBookingItem[];
  receiptId: string | null;
  discountCode: string | null;
  discountAmountMinor: number;
  createdAtLabel: string; // when the booking was made (Manila time)
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
    // Filter by the booking's PLAY date (the date shown on each row), not its
    // creation time — a group matches if any of its bookings fall in the range.
    // "hideFuture" caps the upper bound at today (UTC calendar date = the app's
    // "today"), so only today's and past bookings show.
    const localDate: any = {};
    if (filters.dateFrom) localDate.gte = new Date(filters.dateFrom + "T00:00:00.000Z");
    if (filters.dateTo) localDate.lte = new Date(filters.dateTo + "T00:00:00.000Z");
    if (filters.hideFuture) {
      const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
      if (!localDate.lte || localDate.lte > today) localDate.lte = today;
    }
    if (Object.keys(localDate).length) where.bookings = { some: { localDate } };
    if (filters.statuses?.length) where.status = { in: filters.statuses };
    if (filters.paymentStatuses?.length) where.paymentStatus = { in: filters.paymentStatuses };
    if (filters.source === "customer") where.source = "web_app";
    else if (filters.source === "admin") where.source = { in: ["walk_in", "staff", "phone"] };
    if (filters.discountCode) {
      where.discountCode = filters.discountCode === ANY_DISCOUNT ? { not: null } : filters.discountCode;
    }
    if (filters.search) {
      const q = filters.search;
      where.OR = [
        { reference: { contains: q, mode: "insensitive" } },
        { customer: { firstName: { contains: q, mode: "insensitive" } } },
        { customer: { lastName: { contains: q, mode: "insensitive" } } },
        { customer: { mobileNumber: { contains: q, mode: "insensitive" } } },
      ];
    }

    const dir: "asc" | "desc" = filters.sortDir === "asc" ? "asc" : "desc";
    const orderBy =
      filters.sortBy === "customer" ? { customer: { firstName: dir } } :
      filters.sortBy === "status" ? { status: dir } :
      filters.sortBy === "paymentStatus" ? { paymentStatus: dir } :
      filters.sortBy === "amountPaid" ? { amountPaidMinor: dir } :
      filters.sortBy === "total" ? { totalMinor: dir } :
      { createdAt: dir }; // default (and "createdAt")

    const [totalCount, groups] = await Promise.all([
      tx.bookingGroup.count({ where }),
      tx.bookingGroup.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { include: { user: true } },
          bookings: { include: { court: { omit: { imageUrl: true } } }, orderBy: { startsAt: "asc" } },
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
    source: g.source,
    amountPaidMinor: g.amountPaidMinor,
    totalMinor: g.totalMinor,
    notes: g.notes,
    players: g.bookings[0]?.players ?? 1,
    items: compileSlots(g.bookings.map((b: any) => ({ courtName: b.court.name, start: formatUtcTime(b.startsAt), end: formatUtcTime(b.endsAt), priceMinor: b.priceMinor }))),
    receiptId: g.receipts?.[0]?.id ?? null,
    discountCode: g.discountCode ?? null,
    discountAmountMinor: g.discountAmountMinor ?? 0,
    createdAtLabel: g.createdAt ? formatMadeAt(g.createdAt) : "",
  };
}

// "Sep 1, 2026, 2:30 PM" in Manila time — createdAt is a real instant (now() at
// booking creation), so a tz conversion here is correct (unlike the floating-UTC
// slot times).
function formatMadeAt(d: Date): string {
  return d.toLocaleString("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

/** Distinct promo codes that have actually been applied to bookings (snapshot
 *  strings, so codes of since-deleted discounts still appear) — populates the
 *  Bookings-tab discount filter dropdown. */
export async function getUsedDiscountCodes(tenantId: string): Promise<string[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.bookingGroup.findMany({
      where: { tenantId, discountCode: { not: null } },
      distinct: ["discountCode"],
      select: { discountCode: true },
      orderBy: { discountCode: "asc" },
    });
    return rows.map((r) => r.discountCode).filter((c): c is string => !!c);
  });
}

/** Single booking group by id — used by the dispatch grid to open the ops
 *  modal when an admin clicks an occupied block. */
export async function getBookingGroupById(tenantId: string, id: string): Promise<AdminBookingGroup | null> {
  return withTenant(tenantId, async (tx) => {
    const g = await tx.bookingGroup.findFirst({
      where: { tenantId, id },
      include: {
        customer: { include: { user: true } },
        bookings: { include: { court: { omit: { imageUrl: true } } }, orderBy: { startsAt: "asc" } },
        receipts: { select: { id: true }, orderBy: { uploadedAt: "desc" }, take: 1 },
      },
    });
    return g ? mapAdminGroup(g) : null;
  });
}

// HH:MM (kept lexicographically sortable — compileSlots merges by string
// equality/order). Display is converted to AM/PM by formatTimeAmPm.
function formatUtcTime(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
