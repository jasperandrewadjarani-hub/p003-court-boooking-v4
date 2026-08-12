import { resolveTenant } from "@/lib/tenant/resolve";
import { listPriceMatrix } from "@/lib/admin/masterData";
import { PricingManager } from "@/components/admin/PricingManager";

export default async function AdminPricingPage() {
  const tenant = await resolveTenant();
  const rows = await listPriceMatrix(tenant.id);
  return <PricingManager initialRows={rows} />;
}
