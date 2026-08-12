import { withTenant } from "@/lib/tenant/withTenant";

export interface PaymentSettings {
  gcashNumber: string | null;
  gcashAccountName: string | null;
  paymentInstructions: string | null;
  qrImageUrl: string | null;
}

const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  gcashNumber: null,
  gcashAccountName: null,
  paymentInstructions: null,
  qrImageUrl: null,
};

/** v2's "Payments & QR" settings group — GCash number/name/instructions/QR
 * image, all admin-editable (Phase E4). Defaults to nulls (rendered as
 * "ask staff for payment details") until an admin configures them. */
export async function getPaymentSettings(tenantId: string): Promise<PaymentSettings> {
  return withTenant(tenantId, async (tx) => {
    const row = await tx.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key: "payment_settings" } } });
    return row ? { ...DEFAULT_PAYMENT_SETTINGS, ...(row.value as Partial<PaymentSettings>) } : DEFAULT_PAYMENT_SETTINGS;
  });
}
