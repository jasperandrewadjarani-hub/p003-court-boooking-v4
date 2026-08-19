// One-time migration: move each tenant's payment QR images OUT of the
// `payment_settings` JSON blob into their own `payment_qr_images` key, and strip
// the QR bytes (and any legacy qrImageUrl) from payment_settings — so the
// hot-path getPaymentSettings read (every customer page load) stays tiny.
//
// Safe to run before OR after the code deploy: the new getPaymentQrImages falls
// back to payment_settings.qrImages when the dedicated key is absent, so QRs
// never disappear. Idempotent — re-running just re-writes the same split.
//
//   node scripts/split-payment-qr.mjs            # dry-run (report only)
//   node scripts/split-payment-qr.mjs --commit   # perform the split

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

const COMMIT = process.argv.includes("--commit");
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log(`\n=== Split payment QR images (${COMMIT ? "COMMIT" : "DRY-RUN"}) ===`);
  const rows = await prisma.tenantSetting.findMany({ where: { key: "payment_settings" } });
  console.log(`payment_settings rows: ${rows.length}`);

  for (const row of rows) {
    const value = row.value || {};
    const qrImages = value.qrImages ?? (value.qrImageUrl ? [value.qrImageUrl] : []);
    const hadInline = "qrImages" in value || "qrImageUrl" in value;
    const cleanSettings = {
      gcashNumber: value.gcashNumber ?? null,
      gcashAccountName: value.gcashAccountName ?? null,
      paymentInstructions: value.paymentInstructions ?? null,
    };
    console.log(`  tenant ${row.tenantId}: ${qrImages.length} QR image(s); payment_settings ${hadInline ? "HAS" : "no"} inline QR data`);

    if (!COMMIT) continue;

    // 1) write the dedicated key
    await prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId: row.tenantId, key: "payment_qr_images" } },
      update: { value: { qrImages } },
      create: { tenantId: row.tenantId, key: "payment_qr_images", value: { qrImages } },
    });
    // 2) strip QR bytes from payment_settings
    await prisma.tenantSetting.update({
      where: { tenantId_key: { tenantId: row.tenantId, key: "payment_settings" } },
      data: { value: cleanSettings },
    });
    console.log(`    -> wrote payment_qr_images (${qrImages.length}); payment_settings now text-only`);
  }

  if (!COMMIT) console.log("\nDry-run only. Re-run with --commit to apply.");
  else console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
