// Targeted light-mode contrast fixes for the tenant's stored branding, keeping
// the blue brand identity:
//   • lightGrid was ~= the light background (grid lines / borders invisible).
//   • selected-slot text was neon/mid green, clashing with the blue selection
//     tint and reading poorly — set to high-contrast values for the new
//     brand-tinted selection background (dark blue on light, white on dark).
// Reads current branding and patches only these keys. Idempotent.
//
//   node scripts/fix-light-branding.mjs            # dry-run
//   node scripts/fix-light-branding.mjs --commit

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

const SLUG = "dink-and-dunk";
const COMMIT = process.argv.includes("--commit");
const PATCH = {
  lightGrid: "#C3D0E0",          // visible grid lines + panel borders on light
  lightSelectedSlotFont: "#0B3A6B", // dark blue text on the light-blue selection tint
  darkSelectedSlotFont: "#FFFFFF",  // white text on the dark-blue selection tint
};

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) });

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`tenant ${SLUG} not found`);
  const row = await prisma.tenantSetting.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key: "branding" } } });
  if (!row) throw new Error("no branding row");
  const current = row.value;

  console.log("Current -> new:");
  for (const [k, v] of Object.entries(PATCH)) console.log(`  ${k}: ${current[k]} -> ${v}`);

  if (!COMMIT) {
    console.log("\nDry-run. Re-run with --commit to apply.");
    return;
  }
  const next = { ...current, ...PATCH };
  await prisma.tenantSetting.update({ where: { tenantId_key: { tenantId: tenant.id, key: "branding" } }, data: { value: next } });
  console.log("\nApplied.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
