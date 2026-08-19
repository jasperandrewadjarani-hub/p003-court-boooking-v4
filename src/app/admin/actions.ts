"use server";

import { resolveTenant } from "@/lib/tenant/resolve";
import { requireStaff } from "@/lib/auth/staffAuth";
import { getDispatchGrid } from "@/lib/admin/dispatchGrid";
import { listBookings, getBookingGroupById, type BookingFilters } from "@/lib/admin/bookings";
import { recordPayment } from "@/lib/admin/payments";
import { withTenant } from "@/lib/tenant/withTenant";
import {
  listCourts,
  saveCourt,
  deleteCourt,
  type CourtInput,
  listPriceMatrix,
  savePriceMatrixRow,
  deletePriceMatrixRow,
  type PriceMatrixInput,
  listMembershipsAdmin,
  saveMembership,
  deleteMembership,
  type MembershipInput,
  listHolidays,
  saveHoliday,
  deleteHoliday,
  type HolidayInput,
  listDiscounts,
  saveDiscount,
  deleteDiscount,
  type DiscountInput,
} from "@/lib/admin/masterData";
import { blockSlots, unblockSlots, type BlockSlotItem } from "@/lib/admin/blockedSlots";
import {
  getGeneralSettings,
  saveGeneralSettings,
  type GeneralSettings,
  getLoyaltySettings,
  saveLoyaltySettings,
  type LoyaltySettings,
  getNotificationSettings,
  saveNotificationSettings,
  type NotificationSettings,
  getPerformanceSettings,
  savePerformanceSettings,
  type PerformanceSettings,
  getBrandingSettings,
  saveBrandingSettings,
  resetBrandingSettings,
  type BrandingSettings,
  saveBookingRules,
  savePaymentSettings,
} from "@/lib/admin/settings";
import { getBookingRules, type BookingRulesSettings } from "@/lib/booking/availability";
import { getPaymentSettings, type PaymentSettings } from "@/lib/booking/paymentSettings";
import { hashPassword, verifyPassword, validatePassword } from "@/lib/auth/password";
import { getAnalytics } from "@/lib/admin/analytics";

export async function fetchDispatchGridAction(dateKey: string) {
  const tenant = await resolveTenant();
  await requireStaff();
  return getDispatchGrid(tenant.id, dateKey);
}

export async function listBookingsAction(filters: BookingFilters) {
  const tenant = await resolveTenant();
  await requireStaff();
  return listBookings(tenant.id, filters);
}

export async function getBookingGroupAction(bookingGroupId: string) {
  const tenant = await resolveTenant();
  await requireStaff();
  return getBookingGroupById(tenant.id, bookingGroupId);
}

const EDITABLE_FIELDS = ["firstName", "lastName", "mobileNumber", "notes"] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Matches v2's adminUpdateBookingGroup: only contact/notes are editable —
 * court, date, and time are intentionally not (cancel and rebook instead). */
export async function updateBookingGroupAction(bookingGroupId: string, fields: Partial<Record<EditableField, string>>) {
  const tenant = await resolveTenant();
  const staff = await requireStaff();

  try {
    await withTenant(tenant.id, async (tx) => {
      const group = await tx.bookingGroup.findUnique({ where: { id: bookingGroupId } });
      if (!group) throw new Error("Booking not found.");

      const customerFields: Record<string, string> = {};
      if (fields.firstName !== undefined) customerFields.firstName = fields.firstName;
      if (fields.lastName !== undefined) customerFields.lastName = fields.lastName;
      if (fields.mobileNumber !== undefined) customerFields.mobileNumber = fields.mobileNumber;
      if (Object.keys(customerFields).length) {
        await tx.customer.update({ where: { id: group.customerId }, data: customerFields });
      }
      if (fields.notes !== undefined) {
        await tx.bookingGroup.update({ where: { id: bookingGroupId }, data: { notes: fields.notes } });
      }

      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: staff.userId,
          actorKind: "staff",
          entity: "booking_group",
          entityId: bookingGroupId,
          action: "ADMIN_EDIT",
          details: fields,
        },
      });
    });
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function recordPaymentAction(bookingGroupId: string, method: "cash" | "gcash" | "maya" | "credit_card" | "bank_transfer", amountMinor: number) {
  const tenant = await resolveTenant();
  const staff = await requireStaff();
  try {
    const result = await withTenant(tenant.id, (tx) => recordPayment(tx, { tenantId: tenant.id, bookingGroupId, method, amountMinor, staffUserId: staff.userId }));
    return { ok: true as const, result };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

const VALID_STATUSES = ["reserved", "confirmed", "checked_in", "playing", "finished", "cancelled", "lapsed", "no_show"] as const;

export async function updateBookingStatusAction(bookingGroupId: string, newStatus: (typeof VALID_STATUSES)[number]) {
  const tenant = await resolveTenant();
  const staff = await requireStaff();
  if (!VALID_STATUSES.includes(newStatus)) return { ok: false as const, error: `Unknown status: ${newStatus}` };

  try {
    await withTenant(tenant.id, async (tx) => {
      await tx.bookingGroup.update({ where: { id: bookingGroupId }, data: { status: newStatus } });
      await tx.booking.updateMany({ where: { bookingGroupId }, data: { status: newStatus } });
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: staff.userId,
          actorKind: "staff",
          entity: "booking_group",
          entityId: bookingGroupId,
          action: "ADMIN_STATUS_CHANGE",
          details: { newStatus },
        },
      });
    });
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function cancelBookingGroupAction(bookingGroupId: string) {
  return updateBookingStatusAction(bookingGroupId, "cancelled");
}

// ---------------------------------- Courts -------------------------------------

export async function listCourtsAction() {
  const tenant = await resolveTenant();
  await requireStaff();
  return listCourts(tenant.id);
}

export async function saveCourtAction(input: CourtInput) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await saveCourt(tenant.id, input);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function deleteCourtAction(courtId: string) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await deleteCourt(tenant.id, courtId);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

// ------------------------------- Price Matrix -----------------------------------

export async function listPriceMatrixAction() {
  const tenant = await resolveTenant();
  await requireStaff();
  return listPriceMatrix(tenant.id);
}

export async function savePriceMatrixRowAction(input: PriceMatrixInput, existingId?: string) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await savePriceMatrixRow(tenant.id, input, existingId);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function deletePriceMatrixRowAction(id: string) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await deletePriceMatrixRow(tenant.id, id);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

// -------------------------------- Memberships ------------------------------------

export async function listMembershipsAdminAction() {
  const tenant = await resolveTenant();
  await requireStaff();
  return listMembershipsAdmin(tenant.id);
}

export async function saveMembershipAction(input: MembershipInput) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await saveMembership(tenant.id, input);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function deleteMembershipAction(id: string) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await deleteMembership(tenant.id, id);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

// --------------------------------- Holidays ---------------------------------------

export async function listHolidaysAction() {
  const tenant = await resolveTenant();
  await requireStaff();
  return listHolidays(tenant.id);
}

export async function saveHolidayAction(input: HolidayInput) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await saveHoliday(tenant.id, input);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function deleteHolidayAction(id: string) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await deleteHoliday(tenant.id, id);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

// -------------------------------- Discounts ---------------------------------------

export async function listDiscountsAction() {
  const tenant = await resolveTenant();
  await requireStaff();
  return listDiscounts(tenant.id);
}

export async function saveDiscountAction(input: DiscountInput) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await saveDiscount(tenant.id, input);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function deleteDiscountAction(id: string) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await deleteDiscount(tenant.id, id);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

// ------------------------------- Blocked slots -------------------------------------

export async function blockSlotsAction(dateKey: string, items: BlockSlotItem[]) {
  const tenant = await resolveTenant();
  const staff = await requireStaff();
  try {
    await blockSlots(tenant.id, dateKey, items, staff.userId);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function unblockSlotsAction(blockIds: string[]) {
  const tenant = await resolveTenant();
  const staff = await requireStaff();
  try {
    await unblockSlots(tenant.id, blockIds, staff.userId);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

// --------------------------------- Settings ---------------------------------------

export async function fetchAllSettingsAction() {
  const tenant = await resolveTenant();
  await requireStaff();
  const [general, rules, payments, loyalty, notifications] = await Promise.all([
    getGeneralSettings(tenant.id),
    getBookingRules(tenant.id),
    getPaymentSettings(tenant.id),
    getLoyaltySettings(tenant.id),
    getNotificationSettings(tenant.id),
  ]);
  return { general, rules, payments, loyalty, notifications };
}

export async function saveGeneralSettingsAction(input: GeneralSettings) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await saveGeneralSettings(tenant.id, input);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function savePerformanceSettingsAction(input: PerformanceSettings) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await savePerformanceSettings(tenant.id, input);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function fetchBrandingAction() {
  const tenant = await resolveTenant();
  await requireStaff();
  return getBrandingSettings(tenant.id);
}

export async function saveBrandingAction(input: BrandingSettings) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await saveBrandingSettings(tenant.id, input);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function resetBrandingAction() {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await resetBrandingSettings(tenant.id);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function saveBookingRulesAction(input: Partial<BookingRulesSettings>) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await saveBookingRules(tenant.id, input);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function savePaymentSettingsAction(input: Partial<PaymentSettings>) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await savePaymentSettings(tenant.id, input);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function saveLoyaltySettingsAction(input: LoyaltySettings) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await saveLoyaltySettings(tenant.id, input);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function saveNotificationSettingsAction(input: NotificationSettings) {
  const tenant = await resolveTenant();
  await requireStaff();
  try {
    await saveNotificationSettings(tenant.id, input);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function fetchAnalyticsAction(dateFrom: string, dateTo: string) {
  const tenant = await resolveTenant();
  await requireStaff();
  return getAnalytics(tenant.id, dateFrom, dateTo);
}

export async function changeOwnPasswordAction(currentPassword: string, newPassword: string) {
  const tenant = await resolveTenant();
  const staff = await requireStaff();
  try {
    validatePassword(newPassword);
    const rows = await withTenant(tenant.id, (tx) => tx.$queryRaw<{ password_hash: string | null }[]>`SELECT password_hash FROM users WHERE id = ${staff.userId}::uuid LIMIT 1`);
    if (!rows.length || !rows[0].password_hash || !(await verifyPassword(rows[0].password_hash, currentPassword))) {
      throw new Error("Current password is incorrect.");
    }
    const passwordHash = await hashPassword(newPassword);
    await withTenant(tenant.id, (tx) => tx.user.update({ where: { id: staff.userId }, data: { passwordHash } }));
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}
