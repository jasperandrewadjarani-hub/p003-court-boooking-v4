import "server-only";
import type { Prisma } from "@/generated/prisma/client";

// v3b DiscountService.js's normalizeDiscountCode_ pattern exactly.
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,49}$/;

/** Uppercase + trim, then validate against v3b's exact code pattern. Throws
 *  a message safe to show the customer/staff directly. */
export function normalizeDiscountCode(code: string): string {
  const normalized = (code ?? "").trim().toUpperCase();
  if (!CODE_PATTERN.test(normalized)) {
    throw new Error("Invalid discount code.");
  }
  return normalized;
}

export interface DiscountQuote {
  discountId: string;
  code: string;
  type: "percentage" | "fixed_php" | "fixed_php_per_slot";
  value: number; // raw discountValue as stored (percent 1-100, or fixed minor units)
  amountMinor: number; // computed against the taxableAmountMinor passed in
}

/**
 * Non-consuming lookup+validate+compute — matches v3b's getDiscountQuote_.
 * Throws (with a customer/staff-safe message) if the code doesn't exist,
 * isn't active, or has already hit its Maximum Availments. Never mutates
 * timesAvailed — see consumeDiscount for the atomic increment, which must
 * only run after booking rows have been inserted, inside the same
 * transaction.
 */
export async function quoteDiscount(
  tx: Prisma.TransactionClient,
  tenantId: string,
  code: string,
  taxableAmountMinor: number,
  // Number of booked slots (= booked hours) in the cart. Only consumed by the
  // fixed_php_per_slot type, which multiplies its per-slot value by this; the
  // other two types ignore it. Defaults to 1 so a caller that doesn't care
  // about per-slot discounts still gets fixed_php/percentage right.
  slotCount = 1
): Promise<DiscountQuote> {
  const normalized = normalizeDiscountCode(code);

  const discount = await tx.discount.findUnique({
    where: { tenantId_code: { tenantId, code: normalized } },
  });

  if (!discount || !discount.active) {
    throw new Error(`Discount code "${normalized}" is not valid.`);
  }
  if (discount.maxAvailments > 0 && discount.timesAvailed >= discount.maxAvailments) {
    throw new Error(`Discount code "${normalized}" has reached its usage limit.`);
  }

  let raw: number;
  if (discount.discountType === "percentage") {
    raw = Math.round((taxableAmountMinor * discount.discountValue) / 100);
  } else if (discount.discountType === "fixed_php_per_slot") {
    raw = discount.discountValue * Math.max(0, Math.round(slotCount));
  } else {
    raw = discount.discountValue; // fixed_php — once per checkout
  }
  const amountMinor = Math.min(Math.max(raw, 0), Math.max(taxableAmountMinor, 0));

  return {
    discountId: discount.id,
    code: normalized,
    type: discount.discountType as "percentage" | "fixed_php" | "fixed_php_per_slot",
    value: discount.discountValue,
    amountMinor,
  };
}

/**
 * Atomic consume — the concurrency guarantee v3b got from re-reading the row
 * under LockService, here expressed as a single conditional UPDATE. Zero
 * rows affected means another request exhausted it between the preview
 * quote and this call; the caller must treat that as a hard failure and roll
 * back the whole booking transaction (matches v3b: "increment only after
 * rows append successfully, under lock").
 */
export async function consumeDiscount(tx: Prisma.TransactionClient, tenantId: string, discountId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ times_availed: number }[]>`
    UPDATE discounts
    SET times_availed = times_availed + 1, updated_at = now()
    WHERE id = ${discountId}::uuid AND tenant_id = ${tenantId}::uuid AND active
      AND (max_availments = 0 OR times_availed < max_availments)
    RETURNING times_availed
  `;
  return rows.length > 0;
}
