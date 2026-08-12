import "server-only";
import { withTenant } from "@/lib/tenant/withTenant";
import type { Prisma } from "@/generated/prisma/client";
import type { BookingRulesSettings } from "@/lib/booking/availability";
import type { PaymentSettings } from "@/lib/booking/paymentSettings";

export interface GeneralSettings {
  name: string;
  timezone: string;
  currency: string;
}

export interface LoyaltySettings {
  loyaltyCurrencyPerPoint: number;
  loyaltyPointsForFreeHour: number;
}

export interface NotificationSettings {
  customerBookingEmail: boolean;
  adminNewBookingAlert: boolean;
  customerPaymentEmail: boolean;
  adminReceiptAlert: boolean;
  customerReminders: boolean;
  reminderHour: number;
  dailyReport: boolean;
  dailyReportHour: number;
  adminEmails: string; // comma-separated
}

const DEFAULT_LOYALTY: LoyaltySettings = { loyaltyCurrencyPerPoint: 100, loyaltyPointsForFreeHour: 20 };
const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  customerBookingEmail: true,
  adminNewBookingAlert: true,
  customerPaymentEmail: true,
  adminReceiptAlert: true,
  customerReminders: true,
  reminderHour: 18,
  dailyReport: false,
  dailyReportHour: 7,
  adminEmails: "",
};

export async function getGeneralSettings(tenantId: string): Promise<GeneralSettings> {
  return withTenant(tenantId, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return { name: tenant.name, timezone: tenant.timezone, currency: tenant.currency };
  });
}

export async function saveGeneralSettings(tenantId: string, input: GeneralSettings): Promise<void> {
  await withTenant(tenantId, (tx) => tx.tenant.update({ where: { id: tenantId }, data: input }));
}

async function getSettingKey<T>(tenantId: string, key: string, fallback: T): Promise<T> {
  return withTenant(tenantId, async (tx) => {
    const row = await tx.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key } } });
    return row ? { ...fallback, ...(row.value as Partial<T>) } : fallback;
  });
}

async function saveSettingKey(tenantId: string, key: string, value: object): Promise<void> {
  const jsonValue = value as Prisma.InputJsonValue;
  await withTenant(tenantId, (tx) =>
    tx.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: { value: jsonValue },
      create: { tenantId, key, value: jsonValue },
    })
  );
}

export async function getLoyaltySettings(tenantId: string) {
  return getSettingKey(tenantId, "loyalty_settings", DEFAULT_LOYALTY);
}
export async function saveLoyaltySettings(tenantId: string, input: LoyaltySettings) {
  return saveSettingKey(tenantId, "loyalty_settings", input);
}

export async function getNotificationSettings(tenantId: string) {
  return getSettingKey(tenantId, "notification_settings", DEFAULT_NOTIFICATIONS);
}
export async function saveNotificationSettings(tenantId: string, input: NotificationSettings) {
  return saveSettingKey(tenantId, "notification_settings", input);
}

// booking_rules and payment_settings reuse the exact same accessor pattern
// as their read-side counterparts (availability.ts / paymentSettings.ts),
// duplicated here only for the write side since those modules are
// client-safe reads and this is an admin-only write path.
export async function saveBookingRules(tenantId: string, input: Partial<BookingRulesSettings>) {
  return saveSettingKey(tenantId, "booking_rules", input);
}
export async function savePaymentSettings(tenantId: string, input: Partial<PaymentSettings>) {
  return saveSettingKey(tenantId, "payment_settings", input);
}
