// Bind an additional hostname to a tenant so proxy.ts/resolveTenant() route it.
// The app resolves the tenant strictly from a tenant_domains row (no default
// fallback), so any new Vercel domain needs a matching row here to work.
//
//   node scripts/add-tenant-domain.mjs                         # list current domains
//   node scripts/add-tenant-domain.mjs --add <hostname>        # add (keeps existing)
//   node scripts/add-tenant-domain.mjs --add <hostname> --primary   # ...and mark primary
//
// Idempotent: skips if the hostname (case-insensitive) already exists.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

const SLUG = "dink-and-dunk";
const args = process.argv.slice(2);
const addIdx = args.indexOf("--add");
const hostToAdd = addIdx >= 0 ? String(args[addIdx + 1] || "").trim().toLowerCase() : null;
const makePrimary = args.includes("--primary");

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`tenant ${SLUG} not found`);

  const before = await prisma.tenantDomain.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "asc" } });
  console.log(`Current domains for ${tenant.name}:`);
  before.forEach((d) => console.log(`  - ${d.hostname}${d.isPrimary ? "  (primary)" : ""}`));

  if (!hostToAdd) {
    console.log("\nNo --add given; nothing changed.");
    return;
  }

  const exists = before.find((d) => d.hostname.toLowerCase() === hostToAdd);
  if (exists) {
    console.log(`\n"${hostToAdd}" already bound — skipping insert.`);
  } else {
    if (makePrimary) await prisma.tenantDomain.updateMany({ where: { tenantId: tenant.id }, data: { isPrimary: false } });
    await prisma.tenantDomain.create({ data: { tenantId: tenant.id, hostname: hostToAdd, isPrimary: makePrimary } });
    console.log(`\nAdded "${hostToAdd}"${makePrimary ? " (primary)" : ""} -> ${tenant.name}.`);
  }

  const after = await prisma.tenantDomain.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "asc" } });
  console.log("\nDomains now:");
  after.forEach((d) => console.log(`  - ${d.hostname}${d.isPrimary ? "  (primary)" : ""}`));
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
