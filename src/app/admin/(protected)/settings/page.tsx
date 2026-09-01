import { resolveTenant } from "@/lib/tenant/resolve";
import { getGeneralSettings, getLoyaltySettings, getNotificationSettings, getPerformanceSettings, getBrandingForAdmin, getEmailUsageLast24h } from "@/lib/admin/settings";
import { getBookingRules } from "@/lib/booking/availability";
import { getPaymentSettings, getPaymentQrImages } from "@/lib/booking/paymentSettings";
import { SettingsManager } from "@/components/admin/SettingsManager";

export default async function AdminSettingsPage() {
  const tenant = await resolveTenant();
  const [general, rules, payments, qrImages, loyalty, notifications, performance, branding, emailUsage] = await Promise.all([
    getGeneralSettings(tenant.id),
    getBookingRules(tenant.id),
    getPaymentSettings(tenant.id),
    getPaymentQrImages(tenant.id),
    getLoyaltySettings(tenant.id),
    getNotificationSettings(tenant.id),
    getPerformanceSettings(tenant.id),
    getBrandingForAdmin(tenant.id),
    getEmailUsageLast24h(tenant.id),
  ]);
  return (
    <SettingsManager
      general={general}
      rules={rules}
      payments={payments}
      qrImages={qrImages}
      loyalty={loyalty}
      notifications={notifications}
      performance={performance}
      branding={branding}
      emailUsage={emailUsage}
    />
  );
}
