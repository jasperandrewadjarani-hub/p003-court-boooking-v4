import "server-only";
import { withTenant } from "@/lib/tenant/withTenant";
import type { Prisma } from "@/generated/prisma/client";
import type { BookingRulesSettings } from "@/lib/booking/availability";
import type { PaymentSettings } from "@/lib/booking/paymentSettings";

export interface GeneralSettings {
  name: string;
  timezone: string;
  currency: string;
  webAppTitle: string;
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
  weeklyReportEnabled: boolean;
  weeklyReportDay: string;
  weeklyReportHour: number;
  adminEmails: string; // comma-separated
  notificationBcc: string;
}

export interface PerformanceSettings {
  auditLogEnabled: boolean;
}

const DEFAULT_LOYALTY: LoyaltySettings = { loyaltyCurrencyPerPoint: 100, loyaltyPointsForFreeHour: 20 };
const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  customerBookingEmail: false,
  adminNewBookingAlert: false,
  customerPaymentEmail: false,
  adminReceiptAlert: false,
  customerReminders: false,
  reminderHour: 18,
  dailyReport: false,
  dailyReportHour: 22,
  weeklyReportEnabled: false,
  weeklyReportDay: "SUNDAY",
  weeklyReportHour: 22,
  adminEmails: "",
  notificationBcc: "",
};
const DEFAULT_PERFORMANCE: PerformanceSettings = { auditLogEnabled: false };

export async function getGeneralSettings(tenantId: string): Promise<GeneralSettings> {
  const [tenant, extra] = await Promise.all([
    withTenant(tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })),
    getSettingKey(tenantId, "general_extra", { webAppTitle: "" }),
  ]);
  return { name: tenant.name, timezone: tenant.timezone, currency: tenant.currency, webAppTitle: extra.webAppTitle };
}

export async function saveGeneralSettings(tenantId: string, input: GeneralSettings): Promise<void> {
  await withTenant(tenantId, (tx) => tx.tenant.update({ where: { id: tenantId }, data: { name: input.name, timezone: input.timezone, currency: input.currency } }));
  await saveSettingKey(tenantId, "general_extra", { webAppTitle: input.webAppTitle });
}

export async function getPerformanceSettings(tenantId: string) {
  return getSettingKey(tenantId, "performance_settings", DEFAULT_PERFORMANCE);
}
export async function savePerformanceSettings(tenantId: string, input: PerformanceSettings) {
  return saveSettingKey(tenantId, "performance_settings", input);
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
// Cap for inline (data:-URI) image uploads stored in settings JSON — logo and
// GCash QR. ~2MB of encoded string ≈ a ~1.4MB source image, ample for either;
// keeps the settings row small and rejects anything a browser slipped past the
// client-side check. http(s):// URLs (the other supported form) are unbounded.
const MAX_INLINE_IMAGE_CHARS = 2_000_000;
function assertInlineImageOk(field: string, value: string | null | undefined) {
  if (value && value.startsWith("data:") && value.length > MAX_INLINE_IMAGE_CHARS) {
    throw new Error(`${field} image is too large — please use an image under ~1.4MB.`);
  }
}

const MAX_QR_IMAGES = 4;

export async function savePaymentSettings(tenantId: string, input: Partial<PaymentSettings>) {
  if (input.qrImages) {
    if (input.qrImages.length > MAX_QR_IMAGES) throw new Error(`You can upload at most ${MAX_QR_IMAGES} QR images.`);
    input.qrImages.forEach((img, i) => assertInlineImageOk(`QR #${i + 1}`, img));
  }
  return saveSettingKey(tenantId, "payment_settings", input);
}

// ------------------------------- Branding (v3b) --------------------------------
// 32 BRAND_* color keys + logo URL, config-driven per tenant (v3b Config.js).
// Stored as a "branding" TenantSetting JSON blob; injected as CSS custom
// properties into both shells at request time (see brandingToCss).

export interface BrandingSettings {
  primary: string;
  secondary: string;
  danger: string;
  lightPrimary: string;
  lightSecondary: string;
  lightDanger: string;
  darkBackground: string;
  darkPanel: string;
  darkSurface: string;
  darkOption: string;
  darkGrid: string;
  darkFont: string;
  darkMutedFont: string;
  lightBackground: string;
  lightPanel: string;
  lightSurface: string;
  lightOption: string;
  lightGrid: string;
  lightFont: string;
  lightMutedFont: string;
  confirmed: string;
  reserved: string;
  inactive: string;
  unpaid: string;
  awaiting: string;
  paid: string;
  darkOpenSlotFont: string;
  darkSelectedSlotFont: string;
  lightOpenSlotFont: string;
  lightSelectedSlotFont: string;
  logoUrl: string;
}

export const DEFAULT_BRANDING: BrandingSettings = {
  primary: "#C6FF3D",
  secondary: "#2EE6FF",
  danger: "#FF2E7E",
  lightPrimary: "#5C8A00",
  lightSecondary: "#0090A8",
  lightDanger: "#C81760",
  darkBackground: "#060A10",
  darkPanel: "#0D1520",
  darkSurface: "#121B29",
  darkOption: "#121B29",
  darkGrid: "#1C2733",
  darkFont: "#E7F6F2",
  darkMutedFont: "#7C93A3",
  lightBackground: "#F4F7F2",
  lightPanel: "#FFFFFF",
  lightSurface: "#EAF0E4",
  lightOption: "#FFFFFF",
  lightGrid: "#D3DED0",
  lightFont: "#0E1A12",
  lightMutedFont: "#5B6B60",
  confirmed: "#3DFFB0",
  reserved: "#FFCA3A",
  inactive: "#77808C",
  unpaid: "#C62828",
  awaiting: "#FFCA3A",
  paid: "#3DFFB0",
  darkOpenSlotFont: "#7C9A2E",
  darkSelectedSlotFont: "#060A10",
  lightOpenSlotFont: "#5C8A00",
  lightSelectedSlotFont: "#0E1A12",
  logoUrl: "",
};

const HEX = /^#[0-9A-Fa-f]{6}$/;

export async function getBrandingSettings(tenantId: string) {
  return getSettingKey(tenantId, "branding", DEFAULT_BRANDING);
}

export async function saveBrandingSettings(tenantId: string, input: BrandingSettings) {
  for (const [k, v] of Object.entries(input)) {
    if (k === "logoUrl") continue;
    if (typeof v !== "string" || !HEX.test(v)) throw new Error(`Invalid color for ${k}: "${v}" (expected #RRGGBB).`);
  }
  assertInlineImageOk("Logo", input.logoUrl);
  await saveSettingKey(tenantId, "branding", input);
  // Mirror the logo to Tenant.logoUrl so the customer header / resolveTenant
  // pick it up without a second settings read.
  await withTenant(tenantId, (tx) => tx.tenant.update({ where: { id: tenantId }, data: { logoUrl: input.logoUrl || null, primaryColor: input.primary, accentColor: input.secondary } }));
}

export async function resetBrandingSettings(tenantId: string) {
  await saveSettingKey(tenantId, "branding", DEFAULT_BRANDING);
  await withTenant(tenantId, (tx) => tx.tenant.update({ where: { id: tenantId }, data: { primaryColor: DEFAULT_BRANDING.primary, accentColor: DEFAULT_BRANDING.secondary } }));
}

/** Generates the per-tenant CSS-custom-property overrides injected into both
 *  shells (dark on :root, light on :root[data-theme="light"]) so tokens.css's
 *  palette becomes fully per-tenant for both themes. Pure — safe to call from
 *  a server component. */
export function brandingToCss(b: BrandingSettings): string {
  const dark = [
    `--accent-optic:${b.primary}`,
    `--accent-cyan:${b.secondary}`,
    `--accent-magenta:${b.danger}`,
    `--bg-void:${b.darkBackground}`,
    `--bg-panel:${b.darkPanel}`,
    `--bg-raised:${b.darkSurface}`,
    `--line-grid:${b.darkGrid}`,
    `--text-primary:${b.darkFont}`,
    `--text-dim:${b.darkMutedFont}`,
    // --accent-optic-dim is deliberately NOT set here — it's a computed
    // color-mix() in tokens.css (matching v3b CSS.html exactly), not an
    // admin-editable color. --success mirrors v3b's actual binding
    // (document.documentElement.style.setProperty('--success',
    // BRAND_PAID_COLOR) in v3b's JS.html/AdminJS.html) — the Paid Medal
    // color, not the Confirmed/Active color, even though they share the
    // same default hex.
    `--success:${b.paid}`,
    `--status-confirmed:${b.confirmed}`,
    `--status-reserved:${b.reserved}`,
    `--status-inactive:${b.inactive}`,
    `--payment-unpaid:${b.unpaid}`,
    `--payment-awaiting:${b.awaiting}`,
    `--payment-paid:${b.paid}`,
    `--open-slot-text:${b.darkOpenSlotFont}`,
    `--selected-slot-text:${b.darkSelectedSlotFont}`,
  ].join(";");
  const light = [
    `--accent-optic:${b.lightPrimary}`,
    `--accent-cyan:${b.lightSecondary}`,
    `--accent-magenta:${b.lightDanger}`,
    `--bg-void:${b.lightBackground}`,
    `--bg-panel:${b.lightPanel}`,
    `--bg-raised:${b.lightSurface}`,
    `--line-grid:${b.lightGrid}`,
    `--text-primary:${b.lightFont}`,
    `--text-dim:${b.lightMutedFont}`,
    `--success:${b.paid}`,
    `--status-confirmed:${b.confirmed}`,
    `--status-reserved:${b.reserved}`,
    `--status-inactive:${b.inactive}`,
    `--payment-unpaid:${b.unpaid}`,
    `--payment-awaiting:${b.awaiting}`,
    `--payment-paid:${b.paid}`,
    `--open-slot-text:${b.lightOpenSlotFont}`,
    `--selected-slot-text:${b.lightSelectedSlotFont}`,
  ].join(";");
  return `:root{${dark}}:root[data-theme="light"]{${light}}`;
}
