import { resolveTenant } from "@/lib/tenant/resolve";
import { listBookings } from "@/lib/admin/bookings";
import { BookingsTable } from "@/components/admin/BookingsTable";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAheadKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function AdminBookingsPage() {
  const tenant = await resolveTenant();
  // Default view: today -> +7 days, matching BookingsTable's own client-side
  // default so the initial render and the filter inputs agree from the start.
  const initial = await listBookings(tenant.id, { dateFrom: todayKey(), dateTo: daysAheadKey(7), page: 1, pageSize: 20 });
  return <BookingsTable initialResult={initial} currency={tenant.currency} />;
}
