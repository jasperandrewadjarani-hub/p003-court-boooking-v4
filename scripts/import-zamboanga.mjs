// One-shot importer: matches the deployed `dink-and-dunk` tenant's config to the
// real Zamboanga workbook, loads all 22 customers / 352 booking groups (3,672
// rows) / payments / 15 blocked slots for big-data testing, and creates the
// dndzc@gmail.com admin. Connects like prisma/seed.ts (DIRECT_URL, RLS-bypass
// migration role). Idempotent-ish: it RESETS booking/customer/blocked data for
// the tenant first, then re-imports, so re-running is safe.
//
// Run: node scripts/import-zamboanga.mjs <configJson> <bookingsJson>
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "@node-rs/argon2";
import { readFileSync } from "fs";

const [configPath, bookingsPath] = process.argv.slice(2);
const cfg = JSON.parse(readFileSync(configPath, "utf8"));
const bookingsRaw = JSON.parse(readFileSync(bookingsPath, "utf8"));

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

const SLUG = "dink-and-dunk";
const TZ = "Asia/Manila";
const PHP = (v) => Math.round((Number(String(v).replace(/[, ]/g, "")) || 0) * 100); // PHP -> minor

// ---- helpers to read a tab as array-of-objects keyed by header ----
function asObjects(rows) {
  if (!rows || !rows.length) return [];
  const h = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""])));
}
const configMap = Object.fromEntries((cfg.Config || []).slice(1).map((r) => [r[0], r[1]]));
const C = (k, d = "") => (configMap[k] ?? d);

const courtsTab = asObjects(cfg.Courts);
const custTab = asObjects(cfg.Customers);
const payTab = asObjects(cfg.Payments);
const blockTab = asObjects(cfg.BlockedSlots);
const membTab = asObjects(cfg.Memberships);
const bookings = asObjects(bookingsRaw);

// ---- time construction (Manila local -> UTC instant) ----
function padTime(t) {
  const [h, m] = String(t).split(":");
  return `${String(h).padStart(2, "0")}:${String(m ?? "0").padStart(2, "0")}`;
}
// v4 stores slot times as "floating" local wall-clock in a UTC timestamp
// (see create.ts toUtcDate: `${dateKey}T${time}:00.000Z`), and reads them back
// with formatUtcTime. So build the instant with a Z suffix — NOT a +08:00
// offset — so 19:00 Manila is stored as 19:00Z and displays as 19:00, not 11:00.
function manila(dateIso, timeStr) {
  return new Date(`${String(dateIso).slice(0, 10)}T${padTime(timeStr)}:00.000Z`);
}

const STATUS = { confirmed: "confirmed", reserved: "reserved", lapsed: "lapsed", cancelled: "cancelled", "checked in": "checked_in", playing: "playing", finished: "finished", "no show": "no_show" };
const PAYSTAT = { unpaid: "unpaid", paid: "paid", "awaiting verification": "awaiting_verification", partial: "partial", refunded: "refunded" };
const SOURCE = { "web app": "web_app", staff: "staff", "walk in": "walk_in", walkin: "walk_in", phone: "phone" };
const METHOD = { cash: "cash", gcash: "gcash", maya: "maya", "credit card": "credit_card", "bank transfer": "bank_transfer" };
const mapEnum = (m, v, d) => m[String(v || "").trim().toLowerCase()] ?? d;

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`tenant ${SLUG} not found`);
  const tid = tenant.id;
  console.log(`Tenant: ${tenant.name} (${tid})`);

  // ---------- RESET tenant transactional data ----------
  // Payment + Receipt FKs to BookingGroup are onDelete:Restrict, so clear them
  // before the groups; Booking is Cascade so it goes with the group.
  await prisma.payment.deleteMany({ where: { tenantId: tid } });
  await prisma.receipt.deleteMany({ where: { tenantId: tid } });
  await prisma.bookingGroup.deleteMany({ where: { tenantId: tid } });
  await prisma.blockedSlot.deleteMany({ where: { tenantId: tid } });
  await prisma.customer.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid, kind: "customer" } });
  console.log("Reset: cleared payments, receipts, bookings, blocked slots, customers.");

  // ---------- Tenant + branding + settings ----------
  const branding = {
    primary: C("BRAND_PRIMARY_COLOR", "#62B7FF"), secondary: C("BRAND_SECONDARY_COLOR", "#FFD166"), danger: C("BRAND_DANGER_COLOR", "#FF6577"),
    lightPrimary: C("BRAND_LIGHT_PRIMARY_COLOR"), lightSecondary: C("BRAND_LIGHT_SECONDARY_COLOR"), lightDanger: C("BRAND_LIGHT_DANGER_COLOR"),
    darkBackground: C("BRAND_DARK_BACKGROUND_COLOR"), darkPanel: C("BRAND_DARK_PANEL_COLOR"), darkSurface: C("BRAND_DARK_SURFACE_COLOR"),
    darkOption: C("BRAND_DARK_OPTION_COLOR"), darkGrid: C("BRAND_DARK_GRID_COLOR"), darkFont: C("BRAND_DARK_FONT_COLOR"), darkMutedFont: C("BRAND_DARK_MUTED_FONT_COLOR"),
    lightBackground: C("BRAND_LIGHT_BACKGROUND_COLOR"), lightPanel: C("BRAND_LIGHT_PANEL_COLOR"), lightSurface: C("BRAND_LIGHT_SURFACE_COLOR"),
    lightOption: C("BRAND_LIGHT_OPTION_COLOR"), lightGrid: C("BRAND_LIGHT_GRID_COLOR"), lightFont: C("BRAND_LIGHT_FONT_COLOR"), lightMutedFont: C("BRAND_LIGHT_MUTED_FONT_COLOR"),
    confirmed: C("BRAND_CONFIRMED_COLOR"), reserved: C("BRAND_RESERVED_COLOR"), inactive: C("BRAND_INACTIVE_COLOR"),
    unpaid: C("BRAND_UNPAID_COLOR"), awaiting: C("BRAND_AWAITING_COLOR"), paid: C("BRAND_PAID_COLOR"),
    darkOpenSlotFont: C("BRAND_DARK_OPEN_SLOT_FONT_COLOR"), darkSelectedSlotFont: C("BRAND_DARK_SELECTED_SLOT_FONT_COLOR"),
    lightOpenSlotFont: C("BRAND_LIGHT_OPEN_SLOT_FONT_COLOR"), lightSelectedSlotFont: C("BRAND_LIGHT_SELECTED_SLOT_FONT_COLOR"),
    logoUrl: C("BRAND_LOGO_URL", ""),
  };
  await prisma.tenant.update({ where: { id: tid }, data: { name: C("BUSINESS_NAME", tenant.name), logoUrl: branding.logoUrl || null, primaryColor: branding.primary, accentColor: branding.secondary, timezone: C("TIMEZONE", TZ), currency: C("CURRENCY", "PHP") } });

  const bookingRules = {
    slotMinutes: Number(C("SLOT_MINUTES", 60)), customerGridStartTime: C("CUSTOMER_GRID_START_TIME", "08:00"), customerGridEndTime: C("CUSTOMER_GRID_END_TIME", "23:00"),
    adminGridStartTime: C("ADMIN_GRID_START_TIME", "00:00"), adminGridEndTime: C("ADMIN_GRID_END_TIME", "00:00"), turnoverBufferMinutes: Number(C("BUFFER_MINUTES", 0)),
    maxAdvanceBookingDays: Number(C("MAX_ADVANCE_BOOKING_DAYS", 30)), minBookingMinutes: Number(C("MIN_BOOKING_MINUTES", 60)), maxBookingMinutes: Number(C("MAX_BOOKING_MINUTES", 2500)),
    maxCourtHoursPerBooking: Number(C("MAX_COURT_HOURS_PER_BOOKING", 72)), maxPendingCustomerBookings: Number(C("MAX_PENDING_CUSTOMER_BOOKINGS", 2)),
    cancellationWindowHours: Number(C("CANCELLATION_WINDOW_HOURS", 12)), taxRatePercent: Number(C("TAX_RATE", 0)), reservationHoldMinutes: Number(C("RESERVATION_HOLD_MINUTES", 30)), receiptReviewHoldMinutes: Number(C("RECEIPT_REVIEW_HOLD_MINUTES", 1440)),
  };
  const payment = { gcashNumber: C("GCASH_NUMBER"), gcashAccountName: C("GCASH_ACCOUNT_NAME"), paymentInstructions: C("PAYMENT_INSTRUCTIONS"), qrImageUrl: C("PAYMENT_QR_IMAGE_URL") || null };
  const loyalty = { loyaltyCurrencyPerPoint: Number(C("LOYALTY_CURRENCY_PER_POINT", 100)), loyaltyPointsForFreeHour: Number(C("LOYALTY_POINTS_FOR_FREE_HOUR", 500)) };
  const truthy = (v) => String(v).trim().toLowerCase() === "true";
  const notifications = {
    customerBookingEmail: truthy(C("CUSTOMER_BOOKING_EMAIL_ENABLED")), adminNewBookingAlert: truthy(C("ADMIN_NEW_BOOKING_ALERTS_ENABLED")), customerPaymentEmail: truthy(C("CUSTOMER_PAYMENT_EMAIL_ENABLED")),
    adminReceiptAlert: truthy(C("ADMIN_RECEIPT_ALERTS_ENABLED")), customerReminders: truthy(C("CUSTOMER_REMINDERS_ENABLED")), reminderHour: Number(C("CUSTOMER_REMINDER_HOUR", 18)),
    dailyReport: truthy(C("DAILY_REPORT_ENABLED")), dailyReportHour: Number(C("DAILY_REPORT_HOUR", 22)), weeklyReportEnabled: truthy(C("WEEKLY_REPORT_ENABLED")),
    weeklyReportDay: C("WEEKLY_REPORT_DAY", "SUNDAY"), weeklyReportHour: Number(C("WEEKLY_REPORT_HOUR", 22)), adminEmails: C("ADMIN_EMAILS", ""), notificationBcc: C("NOTIFICATION_BCC") === "undefined" ? "" : C("NOTIFICATION_BCC", ""),
  };
  const settings = { booking_rules: bookingRules, payment_settings: payment, branding, general_extra: { webAppTitle: C("WEB_APP_TITLE", "") }, loyalty_settings: loyalty, notification_settings: notifications };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.tenantSetting.upsert({ where: { tenantId_key: { tenantId: tid, key } }, update: { value }, create: { tenantId: tid, key, value } });
  }
  console.log("Config synced: branding(blue), booking_rules, payment, loyalty, notifications, webAppTitle.");

  // ---------- Courts ----------
  const courtByCode = {};
  for (const c of courtsTab) {
    const code = c["Court ID"];
    const court = await prisma.court.upsert({
      where: { tenantId_code: { tenantId: tid, code } },
      update: { name: c["Court Name"], indoor: truthy(c["Indoor"]), status: "available", surface: c["Surface"] || null, lighting: c["Lighting"] || null, capacity: Number(c["Capacity"] || 50), airConditioned: truthy(c["Air Conditioned"]), baseRateMinor: PHP(c["Base Rate Per Hour"]), lightingFeeMinor: PHP(c["Lighting Fee"]), description: c["Description"] || null },
      create: { tenantId: tid, code, name: c["Court Name"], indoor: truthy(c["Indoor"]), status: "available", surface: c["Surface"] || null, lighting: c["Lighting"] || null, capacity: Number(c["Capacity"] || 50), airConditioned: truthy(c["Air Conditioned"]), baseRateMinor: PHP(c["Base Rate Per Hour"]), lightingFeeMinor: PHP(c["Lighting Fee"]), description: c["Description"] || null },
    });
    courtByCode[code] = court.id;
  }
  console.log(`Courts upserted: ${Object.keys(courtByCode).length}`);

  // ---------- Price matrix ----------
  await prisma.priceMatrixRow.deleteMany({ where: { tenantId: tid } });
  await prisma.priceMatrixRow.createMany({ data: asObjects(cfg.PriceMatrix).map((r) => ({ tenantId: tid, dayType: r["Day Type"].toLowerCase(), startTime: padTime(r["Start Time"]), endTime: padTime(r["End Time"]), courtType: r["Court Type"].toLowerCase(), pricePerHourMinor: PHP(r["Price Per Hour"]) })) });

  // ---------- Memberships ----------
  for (const m of membTab) {
    await prisma.membership.upsert({
      where: { tenantId_name: { tenantId: tid, name: m["Membership"] } },
      update: { monthlyFeeMinor: PHP(m["Monthly Fee"]), discountPercent: Number(m["Discount %"] || 0), priorityBooking: truthy(m["Priority Booking"]), freeHoursMonth: Number(m["Free Hours/Month"] || 0), active: truthy(m["Active"]) },
      create: { tenantId: tid, name: m["Membership"], monthlyFeeMinor: PHP(m["Monthly Fee"]), discountPercent: Number(m["Discount %"] || 0), priorityBooking: truthy(m["Priority Booking"]), freeHoursMonth: Number(m["Free Hours/Month"] || 0), active: truthy(m["Active"]) },
    });
  }

  // ---------- Discounts (replace with workbook's real DND) ----------
  await prisma.discount.deleteMany({ where: { tenantId: tid } });
  for (const d of asObjects(cfg.Discounts)) {
    const type = /fixed/i.test(d["Discount Type"]) ? "fixed_php" : "percentage";
    await prisma.discount.create({ data: { tenantId: tid, code: d["Discount Code"], discountType: type, discountValue: type === "fixed_php" ? PHP(d["Discount Value"]) : Number(d["Discount Value"] || 0), maxAvailments: Number(d["Maximum Availments"] || 0), timesAvailed: Number(d["Times Availed"] || 0), active: truthy(d["Active"]) } });
  }
  console.log("Price matrix, memberships, discounts synced.");

  // ---------- Customers (from Customers tab + any referenced in bookings) ----------
  const custInfo = {}; // custId -> {first,last,mobile,email,membership,registered}
  for (const c of custTab) {
    custInfo[c["Customer ID"]] = { first: c["First Name"] || (c["Full Name"] || "Guest").split(" ")[0], last: c["Last Name"] || (c["Full Name"] || "").split(" ").slice(1).join(" "), mobile: c["Mobile Number"] || null, email: c["Email"] || null, membership: c["Membership Type"] || null, registered: c["Registration Date"] || null };
  }
  for (const b of bookings) {
    const id = b["Customer ID"];
    if (id && !custInfo[id]) {
      const nm = String(b["Customer Name"] || "Guest").trim();
      custInfo[id] = { first: nm.split(" ")[0] || "Guest", last: nm.split(" ").slice(1).join(" ") || "", mobile: b["Phone"] || null, email: null, membership: null, registered: b["Created At"] || null };
    }
  }
  const custIdToDbId = {};
  const usedEmails = new Set();
  for (const [custId, info] of Object.entries(custInfo)) {
    let email = (info.email || "").trim().toLowerCase();
    if (!email || usedEmails.has(email)) email = `${custId.toLowerCase()}@imported.dnd`;
    usedEmails.add(email);
    const reg = info.registered ? new Date(info.registered) : new Date();
    const user = await prisma.user.create({ data: { tenantId: tid, kind: "customer", email, emailVerifiedAt: reg } });
    const cust = await prisma.customer.create({ data: { tenantId: tid, userId: user.id, firstName: info.first || "Guest", lastName: info.last || "", mobileNumber: info.mobile, membershipType: info.membership, registeredAt: reg } });
    custIdToDbId[custId] = cust.id;
  }
  console.log(`Customers created: ${Object.keys(custIdToDbId).length}`);

  // ---------- Blocked slots ----------
  const blkRows = blockTab.filter((r) => r["Court ID"] && courtByCode[r["Court ID"]]).map((r) => ({ tenantId: tid, courtId: courtByCode[r["Court ID"]], localDate: new Date(String(r["Date"]).slice(0, 10)), startsAt: manila(r["Date"], r["Start Time"]), endsAt: manila(r["Date"], r["End Time"]), reason: r["Reason"] || "Admin block", createdAt: r["Created At"] ? new Date(r["Created At"]) : new Date() }));
  if (blkRows.length) await prisma.blockedSlot.createMany({ data: blkRows });
  console.log(`Blocked slots: ${blkRows.length}`);

  // ---------- Bookings (grouped) ----------
  const groups = new Map();
  for (const b of bookings) {
    const id = b["Booking ID"];
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(b);
  }
  let groupsOk = 0, rowsOk = 0, rowsSkipped = 0, groupsFailed = 0;
  const refToGroupId = {};
  for (const [bookingId, rows] of groups) {
    const first = rows[0];
    const custDbId = custIdToDbId[first["Customer ID"]];
    if (!custDbId) { groupsFailed++; continue; }
    const status = mapEnum(STATUS, first["Status"], "confirmed");
    const payStatus = mapEnum(PAYSTAT, first["Payment Status"], "unpaid");
    const source = mapEnum(SOURCE, first["Booking Source"], "staff");
    const discCode = rows.map((r) => r["Discount Code"]).find(Boolean) || null;
    const discAmt = PHP(rows.map((r) => r["Discount Amount"]).find((v) => v && Number(v)) || 0);
    const totalMinor = rows.reduce((s, r) => s + PHP(r["Price"]), 0);
    const createdAt = first["Created At"] ? new Date(first["Created At"]) : manila(first["Booking Date"], "08:00");
    let group;
    try {
      group = await prisma.bookingGroup.create({ data: { tenantId: tid, reference: bookingId, customerId: custDbId, status, paymentStatus: payStatus, source, notes: first["Notes"] || null, totalMinor, discountCode: discCode, discountAmountMinor: discAmt, idempotencyKey: bookingId, createdAt } });
    } catch (e) { groupsFailed++; continue; }
    refToGroupId[bookingId] = group.id;
    const bookingRowsData = rows.filter((r) => courtByCode[r["Court ID"]]).map((r) => {
      const startsAt = manila(r["Booking Date"], r["Start Time"]);
      let endsAt = manila(r["Booking Date"], r["End Time"]);
      if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 24 * 3600 * 1000);
      return { tenantId: tid, bookingGroupId: group.id, courtId: courtByCode[r["Court ID"]], startsAt, endsAt, turnoverBufferMinutes: 0, tz: TZ, durationMinutes: Math.round((endsAt - startsAt) / 60000), players: Number(r["Number of Players"] || 2), priceMinor: PHP(r["Price"]), status };
    });
    // Fast path: one createMany per group; on exclusion/other conflict, fall back to per-row skipping.
    try {
      await prisma.booking.createMany({ data: bookingRowsData });
      rowsOk += bookingRowsData.length;
    } catch {
      for (const row of bookingRowsData) {
        try { await prisma.booking.create({ data: row }); rowsOk++; } catch { rowsSkipped++; }
      }
    }
    groupsOk++;
    if (groupsOk % 50 === 0) console.log(`  ...${groupsOk} groups, ${rowsOk} bookings`);
  }
  console.log(`Bookings imported: ${groupsOk} groups OK (${groupsFailed} failed), ${rowsOk} rows (${rowsSkipped} skipped on conflict).`);

  // ---------- Payments + amountPaid recompute ----------
  let payOk = 0;
  const paidByGroup = {};
  for (const p of payTab) {
    const gid = refToGroupId[p["Booking ID"]];
    if (!gid) continue;
    const amountMinor = PHP(p["Amount"]);
    try {
      await prisma.payment.create({ data: { tenantId: tid, bookingGroupId: gid, method: mapEnum(METHOD, p["Method"], "cash"), amountMinor, discountMinor: PHP(p["Discount"]), taxMinor: PHP(p["Tax"]), totalMinor: PHP(p["Total"]) || amountMinor, receiptNumber: p["Receipt Number"] || `RCPT-${gid.slice(0, 8)}`, collectedAt: p["Date"] ? new Date(p["Date"]) : new Date() } });
      paidByGroup[gid] = (paidByGroup[gid] || 0) + amountMinor;
      payOk++;
    } catch (e) { /* skip dup/receipt collisions */ }
  }
  for (const [gid, minor] of Object.entries(paidByGroup)) {
    await prisma.bookingGroup.update({ where: { id: gid }, data: { amountPaidMinor: minor } });
  }
  console.log(`Payments imported: ${payOk}`);

  // ---------- Admin dndzc@gmail.com ----------
  const adminEmail = "dndzc@gmail.com";
  const existing = await prisma.user.findFirst({ where: { tenantId: tid, email: { equals: adminEmail, mode: "insensitive" } } });
  if (existing) await prisma.user.delete({ where: { id: existing.id } });
  const pwHash = await hash("12345678");
  const adminUser = await prisma.user.create({ data: { tenantId: tid, kind: "staff", email: adminEmail, passwordHash: pwHash, passwordAlgo: "argon2id", emailVerifiedAt: new Date() } });
  await prisma.staff.create({ data: { tenantId: tid, userId: adminUser.id, name: "DND ZC Admin", position: "Owner", role: "owner" } });
  console.log(`Admin created: ${adminEmail} / 12345678 (owner)`);

  // ---------- Summary ----------
  const [gCount, bCount, cCount, pCount, blkCount] = await Promise.all([
    prisma.bookingGroup.count({ where: { tenantId: tid } }), prisma.booking.count({ where: { tenantId: tid } }),
    prisma.customer.count({ where: { tenantId: tid } }), prisma.payment.count({ where: { tenantId: tid } }), prisma.blockedSlot.count({ where: { tenantId: tid } }),
  ]);
  console.log(`\n=== FINAL (tenant ${SLUG}) ===\nbooking_groups=${gCount} bookings=${bCount} customers=${cCount} payments=${pCount} blocked=${blkCount}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
