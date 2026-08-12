import { resolveTenant } from "@/lib/tenant/resolve";
import { listCourts } from "@/lib/admin/masterData";
import { CourtsManager } from "@/components/admin/CourtsManager";

export default async function AdminCourtsPage() {
  const tenant = await resolveTenant();
  const courts = await listCourts(tenant.id);
  return <CourtsManager initialCourts={courts} />;
}
