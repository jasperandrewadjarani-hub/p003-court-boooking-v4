import { resolveTenant } from "@/lib/tenant/resolve";
import { listBookings } from "@/lib/admin/bookings";
import { BookingsTable } from "@/components/admin/BookingsTable";

export default async function AdminBookingsPage() {
  const tenant = await resolveTenant();
  const initial = await listBookings(tenant.id, { page: 1, pageSize: 20 });
  return <BookingsTable initialResult={initial} currency={tenant.currency} />;
}
