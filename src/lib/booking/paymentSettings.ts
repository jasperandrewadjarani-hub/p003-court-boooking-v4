import { withTenant } from "@/lib/tenant/withTenant";

export interface PaymentSettings {
  gcashNumber: string | null;
  gcashAccountName: string | null;
  paymentInstructions: string | null;
}

const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  gcashNumber: null,
  gcashAccountName: null,
  paymentInstructions: null,
};

/** v2's "Payments & QR" text settings — GCash number/name/instructions. The QR
 * IMAGES live in a SEPARATE tenant_settings key (`payment_qr_images`, read via
 * getPaymentQrImages) so this — read on every customer page load — stays tiny.
 * Pulling the ~800 KB of inline QR data-URIs here on every load was pure waste
 * (customers only see QRs after booking, in the success modal). */
export async function getPaymentSettings(tenantId: string): Promise<PaymentSettings> {
  return withTenant(tenantId, async (tx) => {
    const row = await tx.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key: "payment_settings" } } });
    if (!row) return DEFAULT_PAYMENT_SETTINGS;
    const value = row.value as Partial<PaymentSettings>;
    return {
      gcashNumber: value.gcashNumber ?? null,
      gcashAccountName: value.gcashAccountName ?? null,
      paymentInstructions: value.paymentInstructions ?? null,
    };
  });
}

/** The tenant's payment QR images (up to 4), stored in their own
 * `payment_qr_images` key so they're never pulled in the hot path. Read only on
 * demand — by the post-booking success modal and the admin settings page.
 *
 * Back-compat: if the dedicated key doesn't exist yet, fall back to the legacy
 * location (qrImages / the even older single qrImageUrl) inside payment_settings,
 * so nothing breaks before the one-time split migration runs. */
export async function getPaymentQrImages(tenantId: string): Promise<string[]> {
  return withTenant(tenantId, async (tx) => {
    const dedicated = await tx.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key: "payment_qr_images" } } });
    if (dedicated) {
      const v = dedicated.value as { qrImages?: string[] };
      return v.qrImages ?? [];
    }
    const legacy = await tx.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key: "payment_settings" } } });
    if (!legacy) return [];
    const v = legacy.value as { qrImages?: string[]; qrImageUrl?: string | null };
    return v.qrImages ?? (v.qrImageUrl ? [v.qrImageUrl] : []);
  });
}
