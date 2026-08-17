import { resolveTenant } from "@/lib/tenant/resolve";
import { listMembershipsAdmin } from "@/lib/admin/masterData";
import { MembershipsManager } from "@/components/admin/MembershipsManager";
import { DiscountsManager } from "@/components/admin/DiscountsManager";

export default async function AdminMembershipsPage() {
  const tenant = await resolveTenant();
  const memberships = await listMembershipsAdmin(tenant.id);
  return (
    <>
      <MembershipsManager initialMemberships={memberships} />
      <DiscountsManager />
    </>
  );
}
