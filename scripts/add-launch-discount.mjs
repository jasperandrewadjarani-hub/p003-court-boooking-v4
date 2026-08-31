// Create/refresh the "first 50 online bookers — PHP 100 off per slot" launch
// promo for Dink & Dunk (P003 v4).
//
// Uses the new fixed_php_per_slot discount type (PHP off per booked hour), so
// a 4-slot booking gets PHP 400 off. Capped at 50 availments (maxAvailments),
// i.e. the first 50 checkouts that apply the code. Customers enter the code at
// checkout — advertise CODE below.
//
// Requires the 20260831120000_discount_per_slot migration to be applied first
// (so the DB enum has 'fixed_php_per_slot').
//
// Idempotent: upsert by (tenant, code). Re-running preserves timesAvailed.
//
// Usage:
//   node scripts/add-launch-discount.mjs            # dry-run: prints what it would do
//   node scripts/add-launch-discount.mjs --commit   # writes the discount

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

const SLUG = "dink-and-dunk";
const CODE = "LAUNCH100"; // customer-facing promo code (rename here if desired)
const VALUE_MINOR = 10000; // PHP 100.00 per slot
const MAX_AVAILMENTS = 50; // first 50 bookers
const COMMIT = process.argv.includes("--commit");

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
  const prisma = new PrismaClient({ adapter });
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
    if (!tenant) throw new Error(`Tenant "${SLUG}" not found.`);
    const tid = tenant.id;

    const existing = await prisma.discount.findFirst({ where: { tenantId: tid, code: CODE } });
    console.log(`Tenant: ${tenant.name}`);
    console.log(`Promo:  ${CODE} — fixed_php_per_slot, PHP ${(VALUE_MINOR / 100).toFixed(2)}/slot, max ${MAX_AVAILMENTS} availments, active`);
    console.log(existing ? `Existing row found (timesAvailed=${existing.timesAvailed}) — will UPDATE (usage count preserved).` : `No existing row — will CREATE.`);

    if (!COMMIT) {
      console.log("\nDRY-RUN — nothing written. Re-run with --commit to apply.");
      await prisma.$disconnect();
      return;
    }

    if (existing) {
      await prisma.discount.update({
        where: { id: existing.id },
        data: { discountType: "fixed_php_per_slot", discountValue: VALUE_MINOR, maxAvailments: MAX_AVAILMENTS, active: true },
      });
      console.log(`\nUpdated ${CODE}.`);
    } else {
      await prisma.discount.create({
        data: { tenantId: tid, code: CODE, discountType: "fixed_php_per_slot", discountValue: VALUE_MINOR, maxAvailments: MAX_AVAILMENTS, active: true },
      });
      console.log(`\nCreated ${CODE}.`);
    }
    await prisma.$disconnect();
  } catch (e) {
    await prisma.$disconnect();
    console.error("\nERROR:", e.message);
    process.exit(1);
  }
}

main();
