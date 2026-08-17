/**
 * Isomorphic pricing engine — ports v2's calculatePrice_ (PricingService.js)
 * time-overlap segment pricing exactly, but in minor currency units instead
 * of decimal amounts. No server-only imports: called by the server inside
 * the booking transaction as the sole authority, and by the client for an
 * instant local preview (master plan §4.6). Both call the exact same
 * function — there is only one implementation to keep honest.
 *
 * NOTE — reduced scope for the "clickable slice" milestone: membership
 * discount and holiday multiplier are implemented; tax is implemented but
 * defaults to 0. The full 20-fixture golden-test parity matrix (contract
 * §6, Phase 2 gate 2.1) has not been run yet — treat this as pricing logic
 * that works, not yet pricing logic that's been proven to match v2 to the
 * centavo on every case.
 */

export interface PriceMatrixRuleInput {
  dayType: "weekday" | "weekend";
  startTime: string; // "HH:MM", 24h
  endTime: string;
  courtType: "indoor" | "outdoor";
  pricePerHourMinor: number;
}

export interface CourtPricingInput {
  indoor: boolean;
  baseRateMinor: number | null;
  name: string;
}

export interface HolidayInput {
  date: string; // "YYYY-MM-DD"
  name: string;
  rateMultiplier: number;
}

export interface MembershipInput {
  name: string;
  discountPercent: number;
  active: boolean;
}

export interface PriceCalcInput {
  court: CourtPricingInput;
  priceMatrix: PriceMatrixRuleInput[];
  holidays: HolidayInput[];
  memberships: MembershipInput[];
  date: string; // "YYYY-MM-DD", already resolved to the tenant's local date
  startTime: string; // "HH:MM"
  endTime: string;
  membershipType?: string;
  taxRatePercent?: number; // e.g. 12 for 12%
}

export interface PriceCalcResult {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  hours: number;
  breakdown: string;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTimeStr(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function isWeekend(dateKey: string): boolean {
  const d = new Date(dateKey + "T00:00:00");
  const day = d.getDay();
  return day === 0 || day === 6;
}

export function calculatePrice(input: PriceCalcInput): PriceCalcResult {
  const startMin = toMinutes(input.startTime);
  const endMin = toMinutes(input.endTime);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) {
    throw new Error(`Invalid booking time: ${input.startTime} - ${input.endTime}.`);
  }
  const hours = (endMin - startMin) / 60;

  const courtType: "indoor" | "outdoor" = input.court.indoor ? "indoor" : "outdoor";
  const holiday = input.holidays.find((h) => h.date === input.date);
  const dayType: "weekday" | "weekend" | "holiday" = holiday ? "holiday" : isWeekend(input.date) ? "weekend" : "weekday";
  const fallbackDayType: "weekday" | "weekend" = isWeekend(input.date) ? "weekend" : "weekday";

  // Every PriceMatrix rule for this day type + court type whose window
  // overlaps the requested slot, so a booking spanning e.g. 4:30pm-6pm can
  // correctly blend an afternoon rate and an evening rate — same as v2.
  const matrixRows = input.priceMatrix
    .map((m) => ({
      dayType: m.dayType,
      courtType: m.courtType,
      start: toMinutes(m.startTime),
      end: toMinutes(m.endTime),
      rate: m.pricePerHourMinor,
    }))
    .filter((m) => {
      const matchesDayType = m.dayType === dayType || (dayType === "holiday" && m.dayType === fallbackDayType);
      return matchesDayType && m.courtType === courtType && m.end > m.start;
    })
    .sort((a, b) => a.start - b.start);

  const holidayMultiplier = holiday && holiday.rateMultiplier > 0 ? holiday.rateMultiplier : 1;
  const hasFlatRate = input.court.baseRateMinor !== null && input.court.baseRateMinor !== undefined;

  let subtotalMinor = 0;
  const breakdownParts: string[] = [];
  let cursor = startMin;

  while (cursor < endMin) {
    const rule = matrixRows.find((m) => m.start <= cursor && cursor < m.end);
    const nextRule = matrixRows.find((m) => m.start > cursor);
    const segmentEnd = rule ? Math.min(endMin, rule.end) : Math.min(endMin, nextRule ? nextRule.start : endMin);
    if (!Number.isFinite(segmentEnd) || segmentEnd <= cursor) {
      throw new Error(`PriceMatrix contains an invalid time range for ${courtType} ${dayType}.`);
    }
    const rawRate = rule ? rule.rate : hasFlatRate ? input.court.baseRateMinor! : NaN;
    if (!Number.isFinite(rawRate)) {
      throw new Error(
        `No price is configured for ${input.court.name} at ${minutesToTimeStr(cursor)}. Add a matching price rule or a base rate.`
      );
    }
    const rateMinor = Math.round(rawRate * holidayMultiplier);
    const segmentHours = (segmentEnd - cursor) / 60;
    subtotalMinor += rateMinor * segmentHours;
    breakdownParts.push(`${segmentHours.toFixed(1)}h @ ${(rateMinor / 100).toFixed(2)}/hr${rule ? "" : " (base rate)"}`);
    cursor = segmentEnd;
  }

  const membership = input.memberships.find((m) => m.name === input.membershipType && m.active);
  const discountPercent = membership ? membership.discountPercent : 0;
  const discountMinor = Math.round(subtotalMinor * (discountPercent / 100));
  const taxable = subtotalMinor - discountMinor;
  const taxMinor = Math.round(taxable * ((input.taxRatePercent ?? 0) / 100));
  const totalMinor = taxable + taxMinor;

  return {
    subtotalMinor: Math.round(subtotalMinor),
    discountMinor,
    taxMinor,
    totalMinor: Math.round(totalMinor),
    hours,
    breakdown: breakdownParts.join(" + ") + (discountPercent ? ` − ${discountPercent}% ${input.membershipType} discount` : ""),
  };
}

/** A pre-resolved discount-code quote's type/value — the raw config off the
 *  Discount row (percent 1-100, or fixed minor units), NOT a pre-computed
 *  amount. calculateCartTotal derives the actual amount itself, against its
 *  own cart-level taxableBeforePromo, so it always reflects the current cart
 *  contents (matches v3b's getDiscountQuote_(code, taxableBeforePromotion)). */
export interface CartDiscountInput {
  type: "percentage" | "fixed_php";
  value: number;
}

export interface CartTotalResult {
  items: PriceCalcResult[];
  subtotalMinor: number; // sum of raw pre-membership-discount segment pricing
  membershipDiscountMinor: number; // sum of each item's membership % discount
  discountMinor: number; // the discount-code (promo) amount — v3b's "promotion.amount"
  taxMinor: number; // computed on the post-promo taxable amount
  totalMinor: number; // net total: taxable (post-promo) + tax
  totalHours: number;
}

/**
 * Sums calculatePrice across a multi-item cart, then applies v3b's exact
 * cart-level discount-code + tax order (PricingService.js calculateCartTotal_):
 *   subtotal → membershipDiscount → taxableBeforePromo = subtotal - membershipDiscount
 *   → promoAmount = quote(code, taxableBeforePromo), clamped to [0, taxableBeforePromo]
 *   → taxable = taxableBeforePromo - promoAmount → tax = round(taxable * taxRate/100)
 *   → total = taxable + tax
 * The discount code applies AFTER membership %, BEFORE tax — same as the
 * per-item calculatePrice's own membership-then-tax order, just promoted to
 * the whole-cart level since a promo amount (especially fixed_php) has to be
 * computed once against the cart's combined taxable base, not per item.
 */
export function calculateCartTotal(
  items: Array<{ court: CourtPricingInput; startTime: string; endTime: string }>,
  shared: Omit<PriceCalcInput, "court" | "startTime" | "endTime"> & { discount?: CartDiscountInput | null }
): CartTotalResult {
  const { discount, ...priceShared } = shared;
  const results = items.map((item) => calculatePrice({ ...priceShared, court: item.court, startTime: item.startTime, endTime: item.endTime }));

  const subtotalMinor = results.reduce((s, r) => s + r.subtotalMinor, 0);
  const membershipDiscountMinor = results.reduce((s, r) => s + r.discountMinor, 0);
  const taxableBeforePromo = subtotalMinor - membershipDiscountMinor;

  let discountMinor = 0;
  if (discount) {
    const raw = discount.type === "percentage" ? Math.round((taxableBeforePromo * discount.value) / 100) : discount.value;
    discountMinor = Math.min(Math.max(raw, 0), taxableBeforePromo);
  }

  const taxable = taxableBeforePromo - discountMinor;
  const taxRatePercent = priceShared.taxRatePercent ?? 0;
  const taxMinor = Math.round(taxable * (taxRatePercent / 100));
  const totalMinor = taxable + taxMinor;

  return {
    items: results,
    subtotalMinor: Math.round(subtotalMinor),
    membershipDiscountMinor,
    discountMinor,
    taxMinor,
    totalMinor,
    totalHours: results.reduce((s, r) => s + r.hours, 0),
  };
}
