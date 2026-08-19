// Read-only Supabase/Postgres usage snapshot: total DB size vs the free-tier
// 500 MB cap, plus the biggest tables and key row counts. Connects via
// DIRECT_URL like the other scripts. SELECT-only — never writes.
//
//   node scripts/db-usage.mjs

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

const FREE_TIER_MB = 500; // Supabase Free plan database-size allowance
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

const mb = (bytes) => (Number(bytes) / 1024 / 1024).toFixed(2);

async function main() {
  const [{ db_bytes, db_pretty }] = await prisma.$queryRaw`
    SELECT pg_database_size(current_database()) AS db_bytes,
           pg_size_pretty(pg_database_size(current_database())) AS db_pretty
  `;
  const usedMb = Number(db_bytes) / 1024 / 1024;
  const freeMb = FREE_TIER_MB - usedMb;
  const pct = (usedMb / FREE_TIER_MB) * 100;

  console.log(`\n=== Supabase database usage ===`);
  console.log(`Total database size : ${db_pretty}  (${mb(db_bytes)} MB)`);
  console.log(`Free-tier cap       : ${FREE_TIER_MB} MB`);
  console.log(`Used                : ${pct.toFixed(1)}%`);
  console.log(`Free headroom       : ${freeMb.toFixed(2)} MB`);

  const tables = await prisma.$queryRaw`
    SELECT n.nspname AS schema, c.relname AS table,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
           pg_total_relation_size(c.oid) AS total_bytes
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema')
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 12
  `;
  console.log(`\nBiggest tables (incl. indexes/toast):`);
  for (const t of tables) console.log(`  ${t.total_size.padStart(9)}  ${t.schema}.${t.table}`);

  const [counts] = await prisma.$queryRaw`
    SELECT
      (SELECT count(*) FROM booking_groups) AS booking_groups,
      (SELECT count(*) FROM bookings)       AS bookings,
      (SELECT count(*) FROM customers)      AS customers,
      (SELECT count(*) FROM blocked_slots)  AS blocked_slots,
      (SELECT count(*) FROM payments)       AS payments
  `;
  console.log(`\nKey row counts:`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${String(v).padStart(7)}  ${k}`);
  console.log("");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
