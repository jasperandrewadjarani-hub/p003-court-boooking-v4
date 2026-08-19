import { resolveTenant } from "@/lib/tenant/resolve";
import { listStaffAdmin } from "@/lib/admin/staff";
import { getSuperAdminStatus } from "@/lib/admin/settings";
import { StaffManager } from "@/components/admin/StaffManager";

export default async function AdminStaffPage() {
  const tenant = await resolveTenant();
  const [staff, status] = await Promise.all([listStaffAdmin(tenant.id), getSuperAdminStatus(tenant.id)]);
  return <StaffManager initialStaff={staff} initialSuperAdminSet={status.isSet} />;
}
