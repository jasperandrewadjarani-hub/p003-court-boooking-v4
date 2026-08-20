import { resolveTenant } from "@/lib/tenant/resolve";
import { listPriceMatrix, listCourts } from "@/lib/admin/masterData";
import { PricingManager } from "@/components/admin/PricingManager";

export default async function AdminPricingPage() {
  const tenant = await resolveTenant();
  const [rows, courts] = await Promise.all([listPriceMatrix(tenant.id), listCourts(tenant.id)]);
  return <PricingManager initialRows={rows} courts={courts.map((c) => ({ id: c.id, code: c.code, name: c.name }))} />;
}
