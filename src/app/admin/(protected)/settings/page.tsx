import { resolveTenant } from "@/lib/tenant/resolve";
import { getGeneralSettings, getLoyaltySettings, getNotificationSettings } from "@/lib/admin/settings";
import { getBookingRules } from "@/lib/booking/availability";
import { getPaymentSettings } from "@/lib/booking/paymentSettings";
import { SettingsManager } from "@/components/admin/SettingsManager";

export default async function AdminSettingsPage() {
  const tenant = await resolveTenant();
  const [general, rules, payments, loyalty, notifications] = await Promise.all([
    getGeneralSettings(tenant.id),
    getBookingRules(tenant.id),
    getPaymentSettings(tenant.id),
    getLoyaltySettings(tenant.id),
    getNotificationSettings(tenant.id),
  ]);
  return <SettingsManager general={general} rules={rules} payments={payments} loyalty={loyalty} notifications={notifications} />;
}
