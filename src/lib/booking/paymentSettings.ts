import { withTenant } from "@/lib/tenant/withTenant";

export interface PaymentSettings {
  gcashNumber: string | null;
  gcashAccountName: string | null;
  paymentInstructions: string | null;
  /** Up to 4 QR images the customer can swipe/select between at checkout
   *  (e.g. GCash + Maya + a bank transfer QR + a second GCash number). */
  qrImages: string[];
}

const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  gcashNumber: null,
  gcashAccountName: null,
  paymentInstructions: null,
  qrImages: [],
};

/** v2's "Payments & QR" settings group — GCash number/name/instructions/QR
 * image(s), all admin-editable. Defaults to nulls/empty (rendered as "ask
 * staff for payment details") until an admin configures them.
 *
 * qrImages replaced the older single qrImageUrl field (2026-08-19, client
 * asked for up to 4 selectable QR options) — the fallback below reads an
 * old stored row transparently so nothing needs a manual data migration. */
export async function getPaymentSettings(tenantId: string): Promise<PaymentSettings> {
  return withTenant(tenantId, async (tx) => {
    const row = await tx.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key: "payment_settings" } } });
    if (!row) return DEFAULT_PAYMENT_SETTINGS;
    const value = row.value as Partial<PaymentSettings> & { qrImageUrl?: string | null };
    const qrImages = value.qrImages ?? (value.qrImageUrl ? [value.qrImageUrl] : []);
    return { ...DEFAULT_PAYMENT_SETTINGS, ...value, qrImages };
  });
}
