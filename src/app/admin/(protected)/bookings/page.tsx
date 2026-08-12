import { resolveTenant } from "@/lib/tenant/resolve";
import { listBookings } from "@/lib/admin/bookings";
import { BookingsTable } from "@/components/admin/BookingsTable";

export default async function AdminBookingsPage() {
  const tenant = await resolveTenant();
  const bookings = await listBookings(tenant.id, {});
  return <BookingsTable initialBookings={bookings} currency={tenant.currency} />;
}
