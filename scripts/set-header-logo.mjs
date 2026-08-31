// Set (or clear) a tenant's customer-app HEADER LOGO — the full text/banner
// logo that replaces the round logo + business-name title on the customer app.
// Stored as a base64 data-URI in the "branding" TenantSetting (headerLogoUrl),
// exactly like the existing logoUrl. Editable afterwards in Admin -> Settings
// -> Branding -> "Header Logo".
//
// Usage:
//   node scripts/set-header-logo.mjs <slug> <path-to-image>   # dry-run (prints size)
//   node scripts/set-header-logo.mjs <slug> <path-to-image> --commit
//   node scripts/set-header-logo.mjs <slug> --clear --commit   # remove it
//
// Run with: npx tsx scripts/set-header-logo.mjs ...

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync } from "fs";
import path from "path";

const slug = process.argv[2];
const arg3 = process.argv[3];
const COMMIT = process.argv.includes("--commit");
const CLEAR = process.argv.includes("--clear");
if (!slug || (!CLEAR && !arg3)) {
  console.error("Usage: npx tsx scripts/set-header-logo.mjs <slug> <image|--clear> [--commit]");
  process.exit(1);
}

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

async function main() {
  let dataUri = "";
  if (!CLEAR) {
    const ext = path.extname(arg3).toLowerCase();
    const mime = MIME[ext];
    if (!mime) throw new Error(`Unsupported image type: ${ext}`);
    const bytes = readFileSync(arg3);
    dataUri = `data:${mime};base64,${bytes.toString("base64")}`;
    console.log(`Image: ${arg3}  (${(bytes.length / 1024).toFixed(0)} KB raw -> ${(dataUri.length / 1024).toFixed(0)} KB data-URI)`);
    if (dataUri.length > 2_000_000) throw new Error("Image too large (> ~1.4MB). Compress it first.");
  } else {
    console.log("Clearing header logo.");
  }

  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
  const prisma = new PrismaClient({ adapter });
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error(`Tenant "${slug}" not found.`);
    const row = await prisma.tenantSetting.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key: "branding" } } });
    const branding = (row?.value ?? {});
    console.log(`Tenant: ${tenant.name} — current headerLogoUrl: ${branding.headerLogoUrl ? "(set)" : "(empty)"}`);

    if (!COMMIT) {
      console.log("\nDRY-RUN — nothing written. Add --commit to apply.");
      await prisma.$disconnect();
      return;
    }

    const next = { ...branding, headerLogoUrl: dataUri };
    await prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key: "branding" } },
      update: { value: next },
      create: { tenantId: tenant.id, key: "branding", value: next },
    });
    console.log(`\nDONE — headerLogoUrl ${CLEAR ? "cleared" : "set"} for ${tenant.name}.`);
    await prisma.$disconnect();
  } catch (e) {
    await prisma.$disconnect();
    console.error("\nERROR:", e.message);
    process.exit(1);
  }
}

main();
