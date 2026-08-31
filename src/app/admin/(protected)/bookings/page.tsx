import { resolveTenant } from "@/lib/tenant/resolve";
import { listBookings, getUsedDiscountCodes } from "@/lib/admin/bookings";
import { BookingsTable } from "@/components/admin/BookingsTable";

export default async function AdminBookingsPage() {
  const tenant = await resolveTenant();
  const [initial, discountCodes] = await Promise.all([
    listBookings(tenant.id, { page: 1, pageSize: 20 }),
    getUsedDiscountCodes(tenant.id),
  ]);
  return <BookingsTable initialResult={initial} currency={tenant.currency} discountCodes={discountCodes} />;
}
