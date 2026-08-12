import { withTenant } from "@/lib/tenant/withTenant";

export interface MembershipOption {
  name: string;
  discountPercent: number;
}

export async function getActiveMemberships(tenantId: string): Promise<MembershipOption[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.membership.findMany({ where: { tenantId, active: true }, orderBy: { name: "asc" } });
    return rows.map((m) => ({ name: m.name, discountPercent: Number(m.discountPercent) }));
  });
}
