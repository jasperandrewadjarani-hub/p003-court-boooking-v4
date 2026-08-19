import "server-only";
import { withTenant } from "@/lib/tenant/withTenant";
import { normalizeDiscountCode } from "@/lib/booking/discounts";

// ---------------------------------- Courts -----------------------------------

export interface CourtInput {
  code: string;
  name: string;
  indoor: boolean;
  status: "available" | "maintenance" | "closed";
  surface?: string;
  lighting?: string;
  capacity: number;
  airConditioned: boolean;
  baseRateMinor?: number;
  lightingFeeMinor?: number;
  description?: string;
}

export async function listCourts(tenantId: string) {
  return withTenant(tenantId, (tx) => tx.court.findMany({ where: { tenantId }, orderBy: { sortOrder: "asc" } }));
}

export async function saveCourt(tenantId: string, input: CourtInput) {
  return withTenant(tenantId, (tx) =>
    tx.court.upsert({
      where: { tenantId_code: { tenantId, code: input.code } },
      update: input,
      create: { tenantId, ...input },
    })
  );
}

export async function deleteCourt(tenantId: string, courtId: string) {
  return withTenant(tenantId, (tx) => tx.court.delete({ where: { id: courtId } }));
}

// ------------------------------- Price Matrix ---------------------------------

export interface PriceMatrixInput {
  dayType: "weekday" | "weekend";
  startTime: string;
  endTime: string;
  courtType: "indoor" | "outdoor";
  pricePerHourMinor: number;
}

export async function listPriceMatrix(tenantId: string) {
  return withTenant(tenantId, (tx) => tx.priceMatrixRow.findMany({ where: { tenantId }, orderBy: [{ dayType: "asc" }, { courtType: "asc" }, { startTime: "asc" }] }));
}

export async function savePriceMatrixRow(tenantId: string, input: PriceMatrixInput, existingId?: string) {
  return withTenant(tenantId, (tx) =>
    existingId ? tx.priceMatrixRow.update({ where: { id: existingId }, data: input }) : tx.priceMatrixRow.create({ data: { tenantId, ...input } })
  );
}

export async function deletePriceMatrixRow(tenantId: string, id: string) {
  return withTenant(tenantId, (tx) => tx.priceMatrixRow.delete({ where: { id } }));
}

// -------------------------------- Memberships ----------------------------------

export interface MembershipInput {
  name: string;
  monthlyFeeMinor: number;
  discountPercent: number;
  priorityBooking: boolean;
  freeHoursMonth: number;
  active: boolean;
}

export async function listMembershipsAdmin(tenantId: string) {
  return withTenant(tenantId, (tx) => tx.membership.findMany({ where: { tenantId }, orderBy: { name: "asc" } }));
}

export async function saveMembership(tenantId: string, input: MembershipInput) {
  return withTenant(tenantId, (tx) =>
    tx.membership.upsert({
      where: { tenantId_name: { tenantId, name: input.name } },
      update: input,
      create: { tenantId, ...input },
    })
  );
}

// Membership isn't referenced by a foreign key anywhere (Customer/BookingGroup
// store membershipType as a loose string snapshot, not an FK), so a real
// delete is always safe — no orphaned-reference risk.
export async function deleteMembership(tenantId: string, id: string) {
  return withTenant(tenantId, (tx) => tx.membership.delete({ where: { id } }));
}

// --------------------------------- Holidays -------------------------------------

export interface HolidayInput {
  date: string; // "YYYY-MM-DD"
  name: string;
  rateMultiplier: number;
}

export async function listHolidays(tenantId: string) {
  return withTenant(tenantId, (tx) => tx.holiday.findMany({ where: { tenantId }, orderBy: { date: "asc" } }));
}

export async function saveHoliday(tenantId: string, input: HolidayInput) {
  return withTenant(tenantId, (tx) =>
    tx.holiday.upsert({
      where: { tenantId_date: { tenantId, date: new Date(input.date + "T00:00:00.000Z") } },
      update: { name: input.name, rateMultiplier: input.rateMultiplier },
      create: { tenantId, date: new Date(input.date + "T00:00:00.000Z"), name: input.name, rateMultiplier: input.rateMultiplier },
    })
  );
}

export async function deleteHoliday(tenantId: string, id: string) {
  return withTenant(tenantId, (tx) => tx.holiday.delete({ where: { id } }));
}

// -------------------------------- Discounts -------------------------------------

export interface DiscountInput {
  code: string;
  discountType: "percentage" | "fixed_php";
  discountValue: number;
  maxAvailments: number; // 0 = unlimited
  active: boolean;
}

export async function listDiscounts(tenantId: string) {
  return withTenant(tenantId, (tx) => tx.discount.findMany({ where: { tenantId }, orderBy: { code: "asc" } }));
}

/** Upserts by (tenantId, code) — matches v3b's adminSaveDiscount, which
 *  preserves Times Availed on edit (the update clause here simply never
 *  touches timesAvailed, so an existing row's usage count survives untouched). */
export async function saveDiscount(tenantId: string, input: DiscountInput) {
  const code = normalizeDiscountCode(input.code);
  return withTenant(tenantId, (tx) =>
    tx.discount.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: {
        discountType: input.discountType,
        discountValue: input.discountValue,
        maxAvailments: input.maxAvailments,
        active: input.active,
      },
      create: {
        tenantId,
        code,
        discountType: input.discountType,
        discountValue: input.discountValue,
        maxAvailments: input.maxAvailments,
        active: input.active,
      },
    })
  );
}

// BookingGroup.discountId is onDelete:SetNull — old bookings that used this
// code keep their historical discountAmountMinor, they just lose the live
// link back to the (now-deleted) Discount row. Safe.
export async function deleteDiscount(tenantId: string, id: string) {
  return withTenant(tenantId, (tx) => tx.discount.delete({ where: { id } }));
}
