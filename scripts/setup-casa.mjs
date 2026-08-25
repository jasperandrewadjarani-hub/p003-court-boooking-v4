// One-shot setup for a NEW tenant: Casa Caretaking Courts.
// Creates the tenant + domain + 3 courts + warm rust/cream branding + admin +
// per-court pricing + a batch of demo bookings. Connects like the other scripts
// (DIRECT_URL, migration role). Idempotent-ish: re-running RESETS this tenant's
// transactional data (bookings/customers) and re-writes config, but never
// touches other tenants.
//
//   node scripts/setup-casa.mjs            # dry-run (reports; no writes)
//   node scripts/setup-casa.mjs --commit   # create/refresh the tenant

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "@node-rs/argon2";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";

const COMMIT = process.argv.includes("--commit");
const SLUG = "casa-caretaking";
const NAME = "Casa Caretaking Courts";
const TZ = "Asia/Manila";
const HOSTNAMES = ["casazc-booking.vercel.app", "casa-caretaking.localhost:3000"];
const ADMIN_EMAIL = "casacaretakingzc@gmail.com";
const ADMIN_PW = "12345678";
const LOGO_PATH = "D:/claude_/P003_CourtBookingSystem/v4/casa_caretaking_assets/logo.jpg";

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

const pad2 = (n) => String(n).padStart(2, "0");
const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const floatUtc = (dk, hh) => new Date(`${dk}T${pad2(hh)}:00:00.000Z`);

// Warm "Casa Caretaking" palette — rust/terracotta + cream, on-brand with the
// logo. Dark theme = cozy espresso + rust; light theme = cream + rust (closest
// to the brand's cream posters).
const BRANDING = {
  // dark accents
  primary: "#E0803D", secondary: "#E8B27A", danger: "#E5533D",
  // light accents
  lightPrimary: "#B4501E", lightSecondary: "#8A5A2B", lightDanger: "#B4233C",
  // dark surfaces/text
  darkBackground: "#241812", darkPanel: "#312016", darkSurface: "#3E2A1D",
  darkOption: "#3E2A1D", darkGrid: "#4A3222", darkFont: "#F5EADB", darkMutedFont: "#C0A588",
  // light surfaces/text
  lightBackground: "#F7F1E3", lightPanel: "#FFFDF7", lightSurface: "#EFE6D3",
  lightOption: "#FFFDF7", lightGrid: "#D9C7A8", lightFont: "#3A2012", lightMutedFont: "#7A5C3F",
  // shared status colors
  confirmed: "#4B9E5F", reserved: "#E0A93D", inactive: "#9A8974",
  unpaid: "#C0492E", awaiting: "#E0A93D", paid: "#4B9E5F",
  // slot fonts
  darkOpenSlotFont: "#C9A87F", darkSelectedSlotFont: "#FFFFFF",
  lightOpenSlotFont: "#6E4A2A", lightSelectedSlotFont: "#3A2012",
  logoUrl: "", // set below from the file
};

const COURTS = [
  { code: "CASA-P1", name: "Pickleball 1", indoor: false, surface: "Outdoor", baseRateMinor: 50000, description: "Outdoor Pickleball" },
  { code: "CASA-P2", name: "Pickleball 2", indoor: false, surface: "Outdoor", baseRateMinor: 50000, description: "Outdoor Pickleball" },
  { code: "CASA-T1", name: "Tennis 1", indoor: false, surface: "Outdoor", baseRateMinor: 50000, description: "Outdoor Tennis" },
];

const BOOKING_RULES = {
  slotMinutes: 60, customerGridStartTime: "08:00", customerGridEndTime: "22:00",
  adminGridStartTime: "06:00", adminGridEndTime: "23:00", turnoverBufferMinutes: 0,
  maxAdvanceBookingDays: 30, minBookingMinutes: 60, maxBookingMinutes: 300,
  maxCourtHoursPerBooking: 12, maxPendingCustomerBookings: 3, cancellationWindowHours: 12,
  taxRatePercent: 0, reservationHoldMinutes: 30, receiptReviewHoldMinutes: 1440,
};

// Demo bookers + a plausible upcoming schedule.
const BOOKERS = [
  "Maria Santos", "Juan Dela Cruz", "Ella Ramos", "Marco Villanueva", "Sophia Reyes",
  "Diego Mendoza", "Bea Cordero", "Rafael Lim", "Nadia Cruz", "Paolo Garcia",
  "Casa Open Play", "Camille Torres",
];

async function main() {
  console.log(`\n=== Setup ${NAME} (${COMMIT ? "COMMIT" : "DRY-RUN"}) ===`);
  const logoBytes = readFileSync(LOGO_PATH);
  BRANDING.logoUrl = `data:image/jpeg;base64,${logoBytes.toString("base64")}`;
  console.log(`Logo: ${(logoBytes.length / 1024).toFixed(0)} KB`);
  console.log(`Courts: ${COURTS.map((c) => c.name).join(", ")}`);
  console.log(`Hostnames: ${HOSTNAMES.join(", ")}`);

  if (!COMMIT) {
    console.log("\nDry-run only. Re-run with --commit.");
    return;
  }

  // ---------- Tenant ----------
  let tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) {
    tenant = await prisma.tenant.create({ data: { slug: SLUG, name: NAME, timezone: TZ, currency: "PHP", locale: "en-PH" } });
    console.log(`Tenant created: ${tenant.id}`);
  } else {
    console.log(`Tenant exists: ${tenant.id} — refreshing config + resetting demo data.`);
  }
  const tid = tenant.id;

  await prisma.tenant.update({
    where: { id: tid },
    data: { name: NAME, logoUrl: BRANDING.logoUrl, primaryColor: BRANDING.primary, accentColor: BRANDING.secondary, timezone: TZ, currency: "PHP" },
  });

  // ---------- Domains (case-insensitive functional unique index → no upsert) ----------
  for (let i = 0; i < HOSTNAMES.length; i++) {
    const host = HOSTNAMES[i];
    const exists = await prisma.$queryRaw`SELECT id FROM tenant_domains WHERE lower(hostname) = ${host.toLowerCase()} LIMIT 1`;
    if (!exists.length) {
      await prisma.tenantDomain.create({ data: { tenantId: tid, hostname: host, isPrimary: i === 0 } });
    }
  }
  console.log(`Domains ensured: ${HOSTNAMES.length}`);

  // ---------- Settings ----------
  const settings = {
    branding: BRANDING,
    general_extra: { webAppTitle: NAME },
    booking_rules: BOOKING_RULES,
    payment_settings: { gcashNumber: "0917 000 0000", gcashAccountName: "Casa Caretaking Courts", paymentInstructions: "Pay via GCash, then upload your receipt to confirm your booking." },
    payment_qr_images: { qrImages: [] },
    loyalty_settings: { loyaltyCurrencyPerPoint: 100, loyaltyPointsForFreeHour: 500 },
    notification_settings: { customerBookingEmail: false, adminNewBookingAlert: false, customerPaymentEmail: false, adminReceiptAlert: false, customerReminders: false, reminderHour: 18, dailyReport: false, dailyReportHour: 22, weeklyReportEnabled: false, weeklyReportDay: "SUNDAY", weeklyReportHour: 22, adminEmails: "", notificationBcc: "" },
    performance_settings: { auditLogEnabled: false },
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.tenantSetting.upsert({ where: { tenantId_key: { tenantId: tid, key } }, update: { value }, create: { tenantId: tid, key, value } });
  }
  console.log("Settings written: branding(warm), rules, payment, loyalty, notifications, general.");

  // ---------- Courts ----------
  const courtByCode = {};
  for (let i = 0; i < COURTS.length; i++) {
    const c = COURTS[i];
    const court = await prisma.court.upsert({
      where: { tenantId_code: { tenantId: tid, code: c.code } },
      update: { name: c.name, indoor: c.indoor, status: "available", surface: c.surface, capacity: 4, baseRateMinor: c.baseRateMinor, description: c.description, sortOrder: i },
      create: { tenantId: tid, code: c.code, name: c.name, indoor: c.indoor, status: "available", surface: c.surface, capacity: 4, baseRateMinor: c.baseRateMinor, description: c.description, sortOrder: i },
    });
    courtByCode[c.code] = court.id;
  }
  console.log(`Courts upserted: ${Object.keys(courtByCode).length}`);

  // ---------- Per-court price rules (All Days, PHP 500/hr) ----------
  await prisma.priceMatrixRow.deleteMany({ where: { tenantId: tid } });
  await prisma.priceMatrixRow.createMany({
    data: Object.values(courtByCode).map((courtId) => ({ tenantId: tid, courtId, dayType: "all", startTime: "06:00", endTime: "23:00", pricePerHourMinor: 50000 })),
  });
  console.log("Price rules: All Days PHP 500/hr per court.");

  // ---------- Reset transactional demo data ----------
  await prisma.payment.deleteMany({ where: { tenantId: tid } });
  await prisma.receipt.deleteMany({ where: { tenantId: tid } });
  await prisma.bookingGroup.deleteMany({ where: { tenantId: tid } });
  await prisma.blockedSlot.deleteMany({ where: { tenantId: tid } });
  await prisma.customer.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid, kind: "customer" } });

  // ---------- Customers ----------
  const custIds = [];
  for (const full of BOOKERS) {
    const [first, ...rest] = full.split(" ");
    const user = await prisma.user.create({ data: { tenantId: tid, kind: "customer", email: `${full.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@demo.casa`, emailVerifiedAt: new Date() } });
    const cust = await prisma.customer.create({ data: { tenantId: tid, userId: user.id, firstName: first, lastName: rest.join(" ") || "", mobileNumber: "0917" + Math.floor(1000000 + Math.random() * 8999999) } });
    custIds.push(cust.id);
  }
  console.log(`Customers created: ${custIds.length}`);

  // ---------- Demo bookings across the next ~10 days ----------
  const courtIds = Object.values(courtByCode);
  const occupied = new Set(); // `${courtId}|${dk}|${hour}`
  const statuses = [
    { status: "confirmed", pay: "paid" }, { status: "confirmed", pay: "paid" },
    { status: "confirmed", pay: "awaiting_verification" }, { status: "reserved", pay: "unpaid" },
    { status: "reserved", pay: "awaiting_verification" },
  ];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let groupsMade = 0, rowsMade = 0, seq = 0;
  const seqByDate = {};

  function tryBooking(dk, custId, courtId, startHour, hours, st) {
    for (let h = startHour; h < startHour + hours; h++) if (occupied.has(`${courtId}|${dk}|${h}`)) return false;
    for (let h = startHour; h < startHour + hours; h++) occupied.add(`${courtId}|${dk}|${h}`);
    return true;
  }

  for (let dayOffset = -2; dayOffset <= 10; dayOffset++) {
    const d = new Date(today); d.setDate(d.getDate() + dayOffset);
    const dk = dateKey(d);
    // 2–5 bookings per day
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const custId = custIds[Math.floor(Math.random() * custIds.length)];
      const courtId = courtIds[Math.floor(Math.random() * courtIds.length)];
      const startHour = 8 + Math.floor(Math.random() * 12); // 8am–7pm
      const hours = 1 + Math.floor(Math.random() * 2); // 1–2h
      if (startHour + hours > 22) continue;
      if (!tryBooking(dk, custId, courtId, startHour, hours, null)) continue;

      const st = statuses[Math.floor(Math.random() * statuses.length)];
      const totalMinor = hours * 50000;
      const paidMinor = st.pay === "paid" ? totalMinor : 0;
      seqByDate[dk] = (seqByDate[dk] || 0) + 1;
      const reference = `CASA-${dk.replace(/-/g, "")}-${pad2(seqByDate[dk])}`;
      const startsAt = floatUtc(dk, startHour);
      const endsAt = new Date(startsAt.getTime() + hours * 3600 * 1000);

      const group = await prisma.bookingGroup.create({
        data: {
          tenantId: tid, reference, customerId: custId, status: st.status, paymentStatus: st.pay,
          source: "web_app", totalMinor, amountPaidMinor: paidMinor, idempotencyKey: reference,
          createdAt: new Date(`${dk}T08:00:00.000Z`),
        },
      });
      await prisma.booking.create({
        data: {
          tenantId: tid, bookingGroupId: group.id, courtId, startsAt, endsAt,
          turnoverBufferMinutes: 0, tz: TZ, durationMinutes: hours * 60, players: 1,
          priceMinor: totalMinor, status: st.status,
        },
      });
      if (paidMinor > 0) {
        await prisma.payment.create({ data: { tenantId: tid, bookingGroupId: group.id, method: "gcash", amountMinor: paidMinor, totalMinor: paidMinor, receiptNumber: `PMT-${reference}` } });
      }
      groupsMade++; rowsMade++;
    }
  }
  console.log(`Demo bookings: ${groupsMade} groups / ${rowsMade} rows across -2..+10 days.`);

  // ---------- Admin staff ----------
  const existingAdmin = await prisma.$queryRaw`SELECT id FROM users WHERE tenant_id = ${tid}::uuid AND lower(email) = ${ADMIN_EMAIL.toLowerCase()} LIMIT 1`;
  if (existingAdmin.length) await prisma.user.delete({ where: { id: existingAdmin[0].id } });
  const pwHash = await hash(ADMIN_PW);
  const adminUser = await prisma.user.create({ data: { tenantId: tid, kind: "staff", email: ADMIN_EMAIL, passwordHash: pwHash, passwordAlgo: "argon2id", emailVerifiedAt: new Date() } });
  await prisma.staff.create({ data: { tenantId: tid, userId: adminUser.id, name: "Casa Caretaking Admin", position: "Owner", role: "owner" } });
  console.log(`Admin: ${ADMIN_EMAIL} / ${ADMIN_PW} (owner)`);

  // ---------- Summary ----------
  const [g, b, c] = await Promise.all([
    prisma.bookingGroup.count({ where: { tenantId: tid } }),
    prisma.booking.count({ where: { tenantId: tid } }),
    prisma.customer.count({ where: { tenantId: tid } }),
  ]);
  console.log(`\n=== DONE (${SLUG}) === booking_groups=${g} bookings=${b} customers=${c}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
