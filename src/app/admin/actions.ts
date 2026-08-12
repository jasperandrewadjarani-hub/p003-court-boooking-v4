"use server";

import { resolveTenant } from "@/lib/tenant/resolve";
import { requireStaff } from "@/lib/auth/staffAuth";
import { getDispatchGrid } from "@/lib/admin/dispatchGrid";

export async function fetchDispatchGridAction(dateKey: string) {
  const tenant = await resolveTenant();
  await requireStaff();
  return getDispatchGrid(tenant.id, dateKey);
}
