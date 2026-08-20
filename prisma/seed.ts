// Seeds >= 2 tenants (master plan §5.6 non-negotiable: every environment,
// including local dev, must have at least 2 tenants so single-tenant
// assumptions fail loudly instead of hiding until a second real facility
// signs up). Run with: npx prisma db seed
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "@node-rs/argon2";

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

// Every seeded tenant gets one owner-role staff account with this password,
// same "facility default password until changed" pattern as v2 — not
// randomized per tenant, since these are $0 test-phase dev fixtures, not
// real production credentials.
const DEFAULT_STAFF_PASSWORD = "ChangeMe123!";

interface SeedCourt {
  code: string;
  name: string;
  indoor: boolean;
  baseRateMinor: number;
  description?: string;
  capacity?: number;
}

interface SeedMembership {
  name: string;
  monthlyFeeMinor: number;
  discountPercent: number;
  priorityBooking?: boolean;
  freeHoursMonth?: number;
  active: boolean;
}

interface SeedPriceMatrixRow {
  dayType: "weekday" | "weekend";
  startTime: string;
  endTime: string;
  courtType: "indoor" | "outdoor";
  pricePerHourMinor: number;
}

interface SeedDiscount {
  code: string;
  discountType: "percentage" | "fixed_php";
  discountValue: number;
  maxAvailments: number;
  active: boolean;
}

// Mirrors BookingRulesSettings (src/lib/booking/availability.ts) — duplicated
// here rather than imported since a standalone seed script shouldn't take on
// a build-time dependency on the app's src tree.
interface SeedBookingRules {
  slotMinutes: number;
  customerGridStartTime: string;
  customerGridEndTime: string;
  adminGridStartTime: string;
  adminGridEndTime: string;
  turnoverBufferMinutes: number;
  maxAdvanceBookingDays: number;
  minBookingMinutes: number;
  maxBookingMinutes: number;
  maxCourtHoursPerBooking: number;
  maxPendingCustomerBookings: number;
  cancellationWindowHours: number;
  taxRatePercent: number;
  reservationHoldMinutes: number;
  receiptReviewHoldMinutes: number;
}

async function seedTenant(input: {
  slug: string;
  name: string;
  hostname: string;
  timezone: string;
  currency: string;
  primaryColor: string;
  accentColor: string;
  courts: SeedCourt[];
  bookingRules: SeedBookingRules;
  priceMatrix: SeedPriceMatrixRow[];
  memberships: SeedMembership[];
  discounts?: SeedDiscount[];
}) {
  const tenant = await prisma.tenant.upsert({
    where: { slug: input.slug },
    update: {},
    create: {
      slug: input.slug,
      name: input.name,
      timezone: input.timezone,
      currency: input.currency,
      primaryColor: input.primaryColor,
      accentColor: input.accentColor,
    },
  });

  // hostname uniqueness is enforced by a raw-SQL case-insensitive functional
  // index (booking_constraints_and_rls migration), which Prisma's DSL can't
  // express as @@unique — so there's no typed `upsert({ where: { hostname }
  // })`. Same pattern applies anywhere `users.email` uniqueness is needed.
  const existingDomain = await prisma.tenantDomain.findFirst({
    where: { hostname: { equals: input.hostname, mode: "insensitive" } },
  });
  if (existingDomain) {
    await prisma.tenantDomain.update({
      where: { id: existingDomain.id },
      data: { tenantId: tenant.id, isPrimary: true },
    });
  } else {
    await prisma.tenantDomain.create({
      data: { tenantId: tenant.id, hostname: input.hostname, isPrimary: true },
    });
  }

  const bookingRulesJson = input.bookingRules as unknown as Prisma.InputJsonValue;
  await prisma.tenantSetting.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "booking_rules" } },
    update: { value: bookingRulesJson },
    create: { tenantId: tenant.id, key: "booking_rules", value: bookingRulesJson },
  });

  await prisma.tenantSetting.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "payment_settings" } },
    update: {},
    create: {
      tenantId: tenant.id,
      key: "payment_settings",
      value: {
        gcashNumber: "0917 000 0000",
        gcashAccountName: input.name,
        paymentInstructions: "Send the exact amount via GCash, then upload your receipt below.",
        qrImageUrl: null,
      },
    },
  });

  for (const court of input.courts) {
    await prisma.court.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: court.code } },
      update: {
        name: court.name,
        indoor: court.indoor,
        baseRateMinor: court.baseRateMinor,
        description: court.description ?? null,
        capacity: court.capacity ?? 4,
        status: "available",
      },
      create: {
        tenantId: tenant.id,
        code: court.code,
        name: court.name,
        indoor: court.indoor,
        baseRateMinor: court.baseRateMinor,
        description: court.description ?? null,
        capacity: court.capacity ?? 4,
        status: "available",
      },
    });
  }

  // Per-court pricing: expand each seed rule (still authored by indoor/outdoor
  // for brevity) into one row per matching court, since the engine now prices
  // by courtId.
  const seededCourts = await prisma.court.findMany({ where: { tenantId: tenant.id }, select: { id: true, indoor: true } });
  await prisma.priceMatrixRow.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.priceMatrixRow.createMany({
    data: input.priceMatrix.flatMap((row) =>
      seededCourts
        .filter((c) => c.indoor === (row.courtType === "indoor"))
        .map((c) => ({ tenantId: tenant.id, courtId: c.id, dayType: row.dayType, startTime: row.startTime, endTime: row.endTime, pricePerHourMinor: row.pricePerHourMinor }))
    ),
  });

  for (const membership of input.memberships) {
    await prisma.membership.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: membership.name } },
      update: {
        monthlyFeeMinor: membership.monthlyFeeMinor,
        discountPercent: membership.discountPercent,
        priorityBooking: membership.priorityBooking ?? false,
        freeHoursMonth: membership.freeHoursMonth ?? 0,
        active: membership.active,
      },
      create: {
        tenantId: tenant.id,
        name: membership.name,
        monthlyFeeMinor: membership.monthlyFeeMinor,
        discountPercent: membership.discountPercent,
        priorityBooking: membership.priorityBooking ?? false,
        freeHoursMonth: membership.freeHoursMonth ?? 0,
        active: membership.active,
      },
    });
  }

  for (const discount of input.discounts ?? []) {
    await prisma.discount.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: discount.code } },
      update: {
        discountType: discount.discountType,
        discountValue: discount.discountValue,
        maxAvailments: discount.maxAvailments,
        active: discount.active,
      },
      create: {
        tenantId: tenant.id,
        code: discount.code,
        discountType: discount.discountType,
        discountValue: discount.discountValue,
        maxAvailments: discount.maxAvailments,
        active: discount.active,
      },
    });
  }

  const staffEmail = `admin@${input.slug}.test`;
  const existingStaffUser = await prisma.user.findFirst({ where: { tenantId: tenant.id, kind: "staff" } });
  if (!existingStaffUser) {
    const passwordHash = await hash(DEFAULT_STAFF_PASSWORD);
    const staffUser = await prisma.user.create({
      data: { tenantId: tenant.id, kind: "staff", email: staffEmail, passwordHash, passwordAlgo: "argon2id", emailVerifiedAt: new Date() },
    });
    await prisma.staff.create({
      data: { tenantId: tenant.id, userId: staffUser.id, name: "Admin", position: "Owner", role: "owner" },
    });
    console.log(`  Staff login: ${staffEmail} / ${DEFAULT_STAFF_PASSWORD}`);
  }

  console.log(`Seeded tenant "${input.name}" (${input.slug}) — ${input.hostname}`);
  return tenant;
}

// v3b live (Dink & Dunk) effective booking_rules — matches DEFAULT_RULES in
// src/lib/booking/availability.ts exactly (parity/v3b_delta.md §2/§7 step 1).
const DND_BOOKING_RULES: SeedBookingRules = {
  slotMinutes: 60,
  customerGridStartTime: "08:00",
  customerGridEndTime: "23:00",
  adminGridStartTime: "00:00",
  adminGridEndTime: "00:00", // full 24h
  turnoverBufferMinutes: 0,
  maxAdvanceBookingDays: 30,
  minBookingMinutes: 60,
  maxBookingMinutes: 2500,
  maxCourtHoursPerBooking: 72,
  maxPendingCustomerBookings: 2,
  cancellationWindowHours: 12,
  taxRatePercent: 0,
  reservationHoldMinutes: 30,
  receiptReviewHoldMinutes: 1440,
};

// Deliberately different from Dink & Dunk's live values (smaller slots,
// shorter windows) — proves per-tenant settings isolation, not meant to
// mirror any real facility.
const DEMO_BOOKING_RULES: SeedBookingRules = {
  slotMinutes: 30,
  customerGridStartTime: "06:00",
  customerGridEndTime: "22:00",
  adminGridStartTime: "00:00",
  adminGridEndTime: "00:00",
  turnoverBufferMinutes: 10,
  maxAdvanceBookingDays: 30,
  minBookingMinutes: 30,
  maxBookingMinutes: 180,
  maxCourtHoursPerBooking: 12,
  maxPendingCustomerBookings: 2,
  cancellationWindowHours: 6,
  taxRatePercent: 0,
  reservationHoldMinutes: 20,
  receiptReviewHoldMinutes: 120,
};

async function main() {
  await seedTenant({
    slug: "dink-and-dunk",
    name: "Dink & Dunk Sports Center",
    hostname: "dink-and-dunk.localhost:3000",
    timezone: "Asia/Manila",
    currency: "PHP",
    primaryColor: "#C6FF3D",
    accentColor: "#2EE6FF",
    // 11-court live roster (parity/v3b_delta.md §5.5): Court 1-6 + Court A-E.
    // Court 4-6 are the cheaper "B-ball Court Wrhs. 1" bay (PHP 400/hr); all
    // others (Silica Wrhs. 1 & 2) are PHP 500/hr.
    courts: [
      { code: "DND-C1", name: "Court 1", indoor: true, baseRateMinor: 50000, description: "Silica Wrhs. 1", capacity: 50 },
      { code: "DND-C2", name: "Court 2", indoor: true, baseRateMinor: 50000, description: "Silica Wrhs. 1", capacity: 50 },
      { code: "DND-C3", name: "Court 3", indoor: true, baseRateMinor: 50000, description: "Silica Wrhs. 1", capacity: 50 },
      { code: "DND-C4", name: "Court 4", indoor: true, baseRateMinor: 40000, description: "B-ball Court Wrhs. 1", capacity: 50 },
      { code: "DND-C5", name: "Court 5", indoor: true, baseRateMinor: 40000, description: "B-ball Court Wrhs. 1", capacity: 50 },
      { code: "DND-C6", name: "Court 6", indoor: true, baseRateMinor: 40000, description: "B-ball Court Wrhs. 1", capacity: 50 },
      { code: "DND-CA", name: "Court A", indoor: true, baseRateMinor: 50000, description: "Silica Wrhs. 2", capacity: 50 },
      { code: "DND-CB", name: "Court B", indoor: true, baseRateMinor: 50000, description: "Silica Wrhs. 2", capacity: 50 },
      { code: "DND-CC", name: "Court C", indoor: true, baseRateMinor: 50000, description: "Silica Wrhs. 2", capacity: 50 },
      { code: "DND-CD", name: "Court D", indoor: true, baseRateMinor: 50000, description: "Silica Wrhs. 2", capacity: 50 },
      { code: "DND-CE", name: "Court E", indoor: true, baseRateMinor: 50000, description: "Silica Wrhs. 2", capacity: 50 },
    ],
    bookingRules: DND_BOOKING_RULES,
    // Live workbook: 5 rows, all PHP 500/hr (parity/v3b_delta.md §5.6).
    priceMatrix: [
      { dayType: "weekday", startTime: "06:00", endTime: "17:00", courtType: "indoor", pricePerHourMinor: 50000 },
      { dayType: "weekday", startTime: "17:00", endTime: "22:00", courtType: "indoor", pricePerHourMinor: 50000 },
      { dayType: "weekend", startTime: "06:00", endTime: "22:00", courtType: "indoor", pricePerHourMinor: 50000 },
      { dayType: "weekday", startTime: "06:00", endTime: "22:00", courtType: "outdoor", pricePerHourMinor: 50000 },
      { dayType: "weekend", startTime: "06:00", endTime: "22:00", courtType: "outdoor", pricePerHourMinor: 50000 },
    ],
    // v3b live: Standard/Silver/Gold all Inactive.
    memberships: [
      { name: "Standard", monthlyFeeMinor: 0, discountPercent: 0, active: false },
      { name: "Silver", monthlyFeeMinor: 60000, discountPercent: 10, freeHoursMonth: 2, active: false },
      { name: "Gold", monthlyFeeMinor: 120000, discountPercent: 20, priorityBooking: true, freeHoursMonth: 5, active: false },
    ],
    discounts: [{ code: "DND10", discountType: "percentage", discountValue: 10, maxAvailments: 0, active: true }],
  });

  // A second tenant only exists to prove isolation — never optional (§5.6).
  await seedTenant({
    slug: "demo-facility",
    name: "Demo Court Facility",
    hostname: "demo-facility.localhost:3000",
    timezone: "Asia/Manila",
    currency: "PHP",
    primaryColor: "#FF6B6B",
    accentColor: "#4ECDC4",
    courts: [
      { code: "DEMO-C1", name: "Court A", indoor: true, baseRateMinor: 50000 },
      { code: "DEMO-C2", name: "Court B", indoor: true, baseRateMinor: 50000 },
    ],
    bookingRules: DEMO_BOOKING_RULES,
    priceMatrix: [
      { dayType: "weekday", startTime: "06:00", endTime: "17:00", courtType: "indoor", pricePerHourMinor: 50000 },
      { dayType: "weekday", startTime: "17:00", endTime: "22:00", courtType: "indoor", pricePerHourMinor: 70000 },
      { dayType: "weekend", startTime: "06:00", endTime: "22:00", courtType: "indoor", pricePerHourMinor: 80000 },
      { dayType: "weekday", startTime: "06:00", endTime: "22:00", courtType: "outdoor", pricePerHourMinor: 40000 },
      { dayType: "weekend", startTime: "06:00", endTime: "22:00", courtType: "outdoor", pricePerHourMinor: 55000 },
    ],
    memberships: [
      { name: "Standard", monthlyFeeMinor: 0, discountPercent: 0, active: true },
      { name: "Gold", monthlyFeeMinor: 120000, discountPercent: 20, priorityBooking: true, freeHoursMonth: 5, active: true },
    ],
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
