// Seeds >= 2 tenants (master plan §5.6 non-negotiable: every environment,
// including local dev, must have at least 2 tenants so single-tenant
// assumptions fail loudly instead of hiding until a second real facility
// signs up). Run with: npx prisma db seed
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

async function seedTenant(input: {
  slug: string;
  name: string;
  hostname: string;
  timezone: string;
  currency: string;
  primaryColor: string;
  accentColor: string;
  courts: { code: string; name: string; indoor: boolean; baseRateMinor: number }[];
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

  await prisma.tenantSetting.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "booking_rules" } },
    update: {},
    create: {
      tenantId: tenant.id,
      key: "booking_rules",
      value: {
        openHour: 6,
        closeHour: 22,
        slotMinutes: 30,
        turnoverBufferMinutes: 10,
        maxAdvanceBookingDays: 30,
        minBookingMinutes: 30,
        maxBookingMinutes: 180,
        cancellationWindowHours: 6,
        reservationHoldMinutes: 20,
        receiptReviewHoldMinutes: 120,
        maxCourtHoursPerBooking: 12,
      },
    },
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
      update: {},
      create: { tenantId: tenant.id, ...court },
    });
  }

  await prisma.priceMatrixRow.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.priceMatrixRow.createMany({
    data: [
      { tenantId: tenant.id, dayType: "weekday", startTime: "06:00", endTime: "17:00", courtType: "indoor", pricePerHourMinor: 50000 },
      { tenantId: tenant.id, dayType: "weekday", startTime: "17:00", endTime: "22:00", courtType: "indoor", pricePerHourMinor: 70000 },
      { tenantId: tenant.id, dayType: "weekend", startTime: "06:00", endTime: "22:00", courtType: "indoor", pricePerHourMinor: 80000 },
      { tenantId: tenant.id, dayType: "weekday", startTime: "06:00", endTime: "22:00", courtType: "outdoor", pricePerHourMinor: 40000 },
      { tenantId: tenant.id, dayType: "weekend", startTime: "06:00", endTime: "22:00", courtType: "outdoor", pricePerHourMinor: 55000 },
    ],
  });

  await prisma.membership.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: "Standard" } },
    update: {},
    create: { tenantId: tenant.id, name: "Standard", monthlyFeeMinor: 0, discountPercent: 0 },
  });
  await prisma.membership.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: "Gold" } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "Gold",
      monthlyFeeMinor: 120000,
      discountPercent: 20,
      priorityBooking: true,
      freeHoursMonth: 5,
    },
  });

  console.log(`Seeded tenant "${input.name}" (${input.slug}) — ${input.hostname}`);
  return tenant;
}

async function main() {
  await seedTenant({
    slug: "dink-and-dunk",
    name: "Dink & Dunk Sports Center",
    hostname: "dink-and-dunk.localhost:3000",
    timezone: "Asia/Manila",
    currency: "PHP",
    primaryColor: "#C6FF3D",
    accentColor: "#2EE6FF",
    courts: [
      { code: "DND-C1", name: "Court 1", indoor: true, baseRateMinor: 60000 },
      { code: "DND-C2", name: "Court 2", indoor: true, baseRateMinor: 60000 },
      { code: "DND-C3", name: "Court 3", indoor: false, baseRateMinor: 45000 },
    ],
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
