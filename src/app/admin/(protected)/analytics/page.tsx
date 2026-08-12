import { resolveTenant } from "@/lib/tenant/resolve";
import { getAnalytics } from "@/lib/admin/analytics";
import { AnalyticsManager } from "@/components/admin/AnalyticsManager";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default async function AdminAnalyticsPage() {
  const tenant = await resolveTenant();
  const data = await getAnalytics(tenant.id, daysAgoKey(30), todayKey());
  return <AnalyticsManager initialData={data} currency={tenant.currency} />;
}
