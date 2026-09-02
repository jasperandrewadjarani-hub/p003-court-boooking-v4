// Provision a staff OWNER account directly (bypasses the super-admin + OTP
// flow) — for a person without email access. Mirrors completeAddStaff's record
// shape exactly (User kind=staff, argon2id, emailVerifiedAt) so the account
// logs in normally at /admin. The password is hashed here; the plaintext is
// never stored or logged.
//
// Usage:
//   npx tsx scripts/create-owner.mjs            # dry-run (checks for a dup)
//   npx tsx scripts/create-owner.mjs --commit

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "@node-rs/argon2";

const SLUG = "dink-and-dunk";
const EMAIL = "seanarsy@gmail.com";
const PASSWORD = "DNDadmin123@*";
const NAME = "Sean Arsy"; // display name (editable in Staff Accounts)
const ROLE = "owner";
const COMMIT = process.argv.includes("--commit");

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) });
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
    if (!tenant) throw new Error(`Tenant "${SLUG}" not found.`);
    const email = EMAIL.trim().toLowerCase();

    const existing = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: { equals: email, mode: "insensitive" } }, include: { staff: true } });
    console.log(`Tenant: ${tenant.name}`);
    console.log(`Account: ${email} — role ${ROLE}, name "${NAME}"`);
    if (existing) {
      console.log(`\n⚠ An account with this email already exists (kind=${existing.kind}${existing.staff ? `, staff role=${existing.staff.role}` : ""}). Not overwriting.`);
      await prisma.$disconnect();
      return;
    }
    console.log("No existing account — will CREATE.");

    if (!COMMIT) {
      console.log("\nDRY-RUN — nothing written. Re-run with --commit to create.");
      await prisma.$disconnect();
      return;
    }

    const passwordHash = await hash(PASSWORD);
    const user = await prisma.user.create({
      data: { tenantId: tenant.id, kind: "staff", email, passwordHash, passwordAlgo: "argon2id", emailVerifiedAt: new Date() },
    });
    await prisma.staff.create({
      data: { tenantId: tenant.id, userId: user.id, name: NAME, position: "Owner", role: ROLE, active: true },
    });
    console.log(`\nCreated owner account ${email} for ${tenant.name}. They can log in at /admin.`);
    await prisma.$disconnect();
  } catch (e) {
    await prisma.$disconnect();
    console.error("\nERROR:", e.message);
    process.exit(1);
  }
}

main();
