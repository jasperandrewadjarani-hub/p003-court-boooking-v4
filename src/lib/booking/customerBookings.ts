import { withTenant } from "@/lib/tenant/withTenant";
import { getCurrentCustomer } from "@/lib/auth/customerAuth";
import { getBookingRules } from "@/lib/booking/availability";
import { sweepLapsedBookings } from "@/lib/booking/expiry";
import { compileSlots } from "@/lib/format";

export interface MyBookingItem {
  courtName: string;
  start: string; // "HH:MM"
  end: string;
  status: string;
}

export interface MyBookingGroup {
  id: string;
  reference: string | null;
  dateLabel: string; // "YYYY-MM-DD" of the first item
  status: string;
  paymentStatus: string;
  totalMinor: number;
  hasReceipt: boolean;
  items: MyBookingItem[];
}

/** "My Bookings" — the signed-in customer's own booking groups, newest first. */
export async function getMyBookings(tenantId: string): Promise<MyBookingGroup[] | null> {
  const customer = await getCurrentCustomer();
  if (!customer) return null;

  const rules = await getBookingRules(tenantId);

  return withTenant(tenantId, async (tx) => {
    await sweepLapsedBookings(tx, tenantId, rules);

    const groups = await tx.bookingGroup.findMany({
      where: { tenantId, customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { bookings: { include: { court: true }, orderBy: { startsAt: "asc" } }, receipts: { select: { id: true } } },
    });

    return groups.map((g) => ({
      id: g.id,
      reference: g.reference,
      dateLabel: g.bookings[0]?.localDate?.toISOString().slice(0, 10) ?? "",
      status: g.status,
      paymentStatus: g.paymentStatus,
      totalMinor: g.totalMinor,
      hasReceipt: g.receipts.length > 0,
      items: compileSlots(
        g.bookings.map((b) => ({
          courtName: b.court.name,
          start: formatUtcTime(b.startsAt),
          end: formatUtcTime(b.endsAt),
          status: b.status,
          priceMinor: b.priceMinor,
        }))
      ),
    }));
  });
}

function formatUtcTime(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
