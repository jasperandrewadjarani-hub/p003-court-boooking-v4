// One-time migration: move each tenant's logo bytes (logoUrl + headerLogoUrl)
// OUT of the always-read "branding" setting and into the on-demand
// "branding_media" key, leaving flags (_hasLogo/_hasHeaderLogo) + a
// _mediaVersion behind. After this, the hot branding read stops pulling the
// ~200-400 KB image bytes on every page load (egress fix). Mirrors the
// split-payment-qr.mjs precedent.
//
// Idempotent: a tenant whose branding already has empty logoUrl/headerLogoUrl
// AND _hasLogo defined is skipped. Also nulls Tenant.logoUrl (bytes no longer
// mirrored there; it's served from branding_media via the cacheable route).
//
// Usage:
//   npx tsx scripts/migrate-branding-media.mjs            # dry-run
//   npx tsx scripts/migrate-branding-media.mjs --commit

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

const COMMIT = process.argv.includes("--commit");
const kb = (s) => (s ? (s.length / 1024).toFixed(0) + "KB" : "—");

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
  const prisma = new PrismaClient({ adapter });
  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, slug: true } });
    console.log(`Tenants: ${tenants.length}  |  mode: ${COMMIT ? "COMMIT" : "DRY-RUN"}\n`);
    let migrated = 0, skipped = 0;
    for (const t of tenants) {
      const row = await prisma.tenantSetting.findUnique({ where: { tenantId_key: { tenantId: t.id, key: "branding" } } });
      const b = row?.value ?? {};
      // No branding row at all, or already split → nothing to move (the app
      // falls back to DEFAULT_BRANDING / the flags for these).
      const alreadySplit = !b.logoUrl && !b.headerLogoUrl && b._hasLogo !== undefined;
      if (!row || alreadySplit) {
        console.log(`  ${t.slug.padEnd(18)} ${!row ? "no branding row" : "already split"} — skip`);
        skipped++;
        continue;
      }
      const media = { logoUrl: b.logoUrl || "", headerLogoUrl: b.headerLogoUrl || "" };
      const core = { ...b, logoUrl: "", headerLogoUrl: "", _hasLogo: !!media.logoUrl, _hasHeaderLogo: !!media.headerLogoUrl, _mediaVersion: String(Date.now()) };
      console.log(`  ${t.slug.padEnd(18)} logo=${kb(media.logoUrl)} header=${kb(media.headerLogoUrl)} -> branding_media  (flags hasLogo=${core._hasLogo} hasHeaderLogo=${core._hasHeaderLogo})`);
      if (COMMIT) {
        await prisma.tenantSetting.upsert({
          where: { tenantId_key: { tenantId: t.id, key: "branding_media" } },
          update: { value: media },
          create: { tenantId: t.id, key: "branding_media", value: media },
        });
        await prisma.tenantSetting.upsert({ where: { tenantId_key: { tenantId: t.id, key: "branding" } }, update: { value: core }, create: { tenantId: t.id, key: "branding", value: core } });
        await prisma.tenant.update({ where: { id: t.id }, data: { logoUrl: null } });
      }
      migrated++;
    }
    console.log(`\n${COMMIT ? "DONE" : "DRY-RUN"} — ${migrated} to migrate, ${skipped} already split.`);
    if (!COMMIT) console.log("Re-run with --commit to apply.");
    await prisma.$disconnect();
  } catch (e) {
    await prisma.$disconnect();
    console.error("\nERROR:", e.message);
    process.exit(1);
  }
}

main();
