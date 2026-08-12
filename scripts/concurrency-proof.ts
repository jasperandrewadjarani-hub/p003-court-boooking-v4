/**
 * Phase 1.7 gate (master plan §8): 50 concurrent inserts for the exact same
 * tenant/court/time slot must produce exactly 1 winner, 49 failures with
 * Postgres exclusion-violation (23P01), and 0 failures of any other kind.
 *
 * This tests the GiST exclusion constraint directly at the database level
 * (bypassing the not-yet-built application booking transaction, per the
 * master plan's own "DB-level concurrency proof" framing) — it's the actual
 * mechanism replacing v2's global LockService, and this is the empirical
 * proof it holds under real concurrency, not just under sequential testing.
 *
 * Run with: npx tsx scripts/concurrency-proof.ts
 */
import { Pool } from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const CONCURRENCY = 50;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: CONCURRENCY + 5 });

  // Look up real seeded fixtures (Dink & Dunk tenant + a court + a customer)
  // rather than hardcoding IDs — this script should keep working as seed
  // data evolves.
  const bootstrap = new Pool({ connectionString: process.env.DIRECT_URL });
  const tenantRes = await bootstrap.query(`SELECT id FROM tenants WHERE slug = 'dink-and-dunk'`);
  if (!tenantRes.rows.length) throw new Error("Seed the dink-and-dunk tenant first (npx prisma db seed)");
  const tenantId = tenantRes.rows[0].id;

  const courtRes = await bootstrap.query(`SELECT id FROM courts WHERE tenant_id = $1 ORDER BY code LIMIT 1`, [tenantId]);
  const courtId = courtRes.rows[0].id;

  // Need at least one customer row (booking_groups.customer_id is NOT NULL).
  // Reuse one if it exists from a prior run, else create a throwaway one.
  let customerRes = await bootstrap.query(
    `SELECT c.id FROM customers c WHERE c.tenant_id = $1 LIMIT 1`,
    [tenantId]
  );
  let customerId: string;
  if (customerRes.rows.length) {
    customerId = customerRes.rows[0].id;
  } else {
    const userRes = await bootstrap.query(
      `INSERT INTO users (id, tenant_id, kind, email, updated_at) VALUES (gen_random_uuid(), $1, 'customer', 'concurrency-proof@example.test', now()) RETURNING id`,
      [tenantId]
    );
    const newCustomer = await bootstrap.query(
      `INSERT INTO customers (id, tenant_id, user_id, first_name, last_name) VALUES (gen_random_uuid(), $1, $2, 'Concurrency', 'Proof') RETURNING id`,
      [tenantId, userRes.rows[0].id]
    );
    customerId = newCustomer.rows[0].id;
  }
  await bootstrap.end();

  // A slot far enough in the future not to collide with anything else, and
  // unique to this run (timestamped) so re-running the script doesn't hit
  // leftover rows from a previous run.
  const startsAt = new Date(Date.now() + 365 * 86400000); // ~1 year out
  const endsAt = new Date(startsAt.getTime() + 60 * 60000); // 1 hour

  console.log(`Firing ${CONCURRENCY} concurrent inserts for the same slot...`);
  console.log(`tenant=${tenantId} court=${courtId} slot=${startsAt.toISOString()}-${endsAt.toISOString()}`);

  const attempts = Array.from({ length: CONCURRENCY }, (_, i) => attemptBooking(pool, {
    tenantId, courtId, customerId, startsAt, endsAt, idempotencyKey: `concurrency-proof-${Date.now()}-${i}`,
  }));

  const results = await Promise.allSettled(attempts);

  let succeeded = 0;
  let exclusionViolations = 0;
  const otherErrors: string[] = [];

  for (const r of results) {
    if (r.status === "fulfilled") {
      succeeded++;
    } else {
      const err = r.reason;
      if (err?.code === "23P01") {
        exclusionViolations++;
      } else {
        otherErrors.push(`${err?.code ?? "?"}: ${err?.message ?? err}`);
      }
    }
  }

  console.log("\n--- Results ---");
  console.log("Succeeded:", succeeded, "(expected: 1)");
  console.log("Exclusion violations (23P01):", exclusionViolations, "(expected:", CONCURRENCY - 1, ")");
  console.log("Other errors:", otherErrors.length, "(expected: 0)");
  if (otherErrors.length) {
    console.log("Other error details:", otherErrors.slice(0, 5));
  }

  const pass = succeeded === 1 && exclusionViolations === CONCURRENCY - 1 && otherErrors.length === 0;
  console.log(pass ? "\nPASS" : "\nFAIL");

  await pool.end();
  process.exit(pass ? 0 : 1);
}

async function attemptBooking(
  pool: Pool,
  args: { tenantId: string; courtId: string; customerId: string; startsAt: Date; endsAt: Date; idempotencyKey: string }
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Transaction-local scope, matching the real withTenant() pattern this
    // script stands in for (master plan §5.1) — never a session-level SET.
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [args.tenantId]);

    const groupRes = await client.query(
      `INSERT INTO booking_groups (id, tenant_id, customer_id, idempotency_key, total_minor, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 50000, now()) RETURNING id`,
      [args.tenantId, args.customerId, args.idempotencyKey]
    );
    const bookingGroupId = groupRes.rows[0].id;

    await client.query(
      `INSERT INTO bookings (id, tenant_id, booking_group_id, court_id, starts_at, ends_at, turnover_buffer_minutes, tz, duration_minutes, price_minor, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 10, 'Asia/Manila', 60, 50000, now())`,
      [args.tenantId, bookingGroupId, args.courtId, args.startsAt, args.endsAt]
    );

    await client.query("COMMIT");
    return bookingGroupId;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((e) => {
  console.error("Script failed:", e);
  process.exit(1);
});
