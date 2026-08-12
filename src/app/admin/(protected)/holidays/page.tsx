import { resolveTenant } from "@/lib/tenant/resolve";
import { listHolidays } from "@/lib/admin/masterData";
import { HolidaysManager } from "@/components/admin/HolidaysManager";

export default async function AdminHolidaysPage() {
  const tenant = await resolveTenant();
  const holidays = await listHolidays(tenant.id);
  return <HolidaysManager initialHolidays={holidays} />;
}
