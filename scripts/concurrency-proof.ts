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
  // randomized (not just timestamped) so re-running the script minutes apart
  // doesn't land within the same 1-hour window as a previous run's committed
  // row — Date.now()-only offsets collided with the prior run's slot the
  // first time this was tried back-to-back (see notes.md 2026-08-12), since
  // a few minutes' difference is well inside a 1-hour exclusion range.
  const startsAt = new Date(Date.now() + (365 + Math.floor(Math.random() * 3650)) * 86400000); // 1–11 years out
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

  const singleSlotPass = succeeded === 1 && exclusionViolations === CONCURRENCY - 1 && otherErrors.length === 0;
  console.log(singleSlotPass ? "\nPASS" : "\nFAIL");

  const cartPass = await cartConflictProof(pool, tenantId, courtId, customerId);
  const adjacentPass = await sameGroupAdjacentProof(pool, tenantId, courtId, customerId);

  await pool.end();
  process.exit(singleSlotPass && cartPass && adjacentPass ? 0 : 1);
}

/**
 * Regression test for a real client-reported bug (2026-08-13, fixed in
 * migration 20260813010000_fix_exclusion_same_group_bug): 3 consecutive
 * back-to-back hours on the same court, in the same cart, always failed
 * with a false "slot taken" — the turnover buffer on item N's end bled
 * into item N+1's start, and the exclusion constraint didn't know both
 * rows belonged to the same checkout. Fixed by adding
 * `booking_group_id WITH <>` to the constraint. This proves it stays
 * fixed: 3 adjacent same-group inserts must all succeed, and a
 * different-group insert into the same buffered window must still fail.
 */
async function sameGroupAdjacentProof(pool: Pool, tenantId: string, courtId: string, customerId: string) {
  const base = new Date(Date.now() + (8000 + Math.floor(Math.random() * 1000)) * 86400000);
  const hour = 60 * 60000;

  console.log("\nFiring 3 consecutive back-to-back slots in one booking group (should all succeed)...");
  const client = await pool.connect();
  let sameGroupPass = false;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const groupRes = await client.query(
      `INSERT INTO booking_groups (id, tenant_id, customer_id, idempotency_key, total_minor, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 150000, now()) RETURNING id`,
      [tenantId, customerId, `adjacent-proof-${Date.now()}`]
    );
    const groupId = groupRes.rows[0].id;
    for (let i = 0; i < 3; i++) {
      const startsAt = new Date(base.getTime() + i * hour);
      const endsAt = new Date(startsAt.getTime() + hour);
      await client.query(
        `INSERT INTO bookings (id, tenant_id, booking_group_id, court_id, starts_at, ends_at, turnover_buffer_minutes, tz, duration_minutes, price_minor, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 10, 'Asia/Manila', 60, 50000, now())`,
        [tenantId, groupId, courtId, startsAt, endsAt]
      );
    }
    await client.query("COMMIT");
    sameGroupPass = true;
    console.log("PASS — 3 adjacent same-group slots inserted without conflict.");
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.log("FAIL —", err.code, err.message);
  } finally {
    client.release();
  }

  console.log("Firing a different-group booking into the same buffered window (should still fail with 23P01)...");
  const client2 = await pool.connect();
  let differentGroupBlocked = false;
  try {
    await client2.query("BEGIN");
    await client2.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const groupRes2 = await client2.query(
      `INSERT INTO booking_groups (id, tenant_id, customer_id, idempotency_key, total_minor, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 50000, now()) RETURNING id`,
      [tenantId, customerId, `adjacent-proof-conflict-${Date.now()}`]
    );
    const groupId2 = groupRes2.rows[0].id;
    const startsAt = new Date(base.getTime() + 65 * 60000); // 5 min into item 0's buffer zone
    const endsAt = new Date(startsAt.getTime() + hour);
    await client2.query(
      `INSERT INTO bookings (id, tenant_id, booking_group_id, court_id, starts_at, ends_at, turnover_buffer_minutes, tz, duration_minutes, price_minor, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 10, 'Asia/Manila', 60, 50000, now())`,
      [tenantId, groupId2, courtId, startsAt, endsAt]
    );
    await client2.query("COMMIT");
    console.log("FAIL — different-group insert should have been rejected but succeeded.");
  } catch (err: any) {
    await client2.query("ROLLBACK").catch(() => {});
    if (err.code === "23P01") {
      differentGroupBlocked = true;
      console.log("PASS — correctly rejected with 23P01 (real double-booking protection intact).");
    } else {
      console.log("FAIL — wrong error:", err.code, err.message);
    }
  } finally {
    client2.release();
  }

  const pass = sameGroupPass && differentGroupBlocked;
  console.log(pass ? "PASS (same-group adjacency)" : "FAIL (same-group adjacency)");
  return pass;
}

/**
 * Phase B gate (master plan §1, "Verify" step): two concurrent 3-item carts
 * sharing exactly one overlapping slot — expect exactly one cart's
 * BookingGroup to commit all 3 rows, the other's transaction to roll back
 * completely (0 partial rows, group row itself never exists), because both
 * the group creation and every item insert happen inside ONE transaction
 * per cart. This is the direct empirical test of create.ts's "all-or-
 * nothing is free — Postgres already gives it, no manual recheck-under-lock
 * needed" claim.
 */
async function cartConflictProof(pool: Pool, tenantId: string, courtId: string, customerId: string) {
  // Same randomization reasoning as the single-slot proof above — a fixed
  // offset collided with a previous run's committed rows when re-run minutes
  // apart.
  const base = Date.now() + (4000 + Math.floor(Math.random() * 3650)) * 86400000; // ~11–21 years out, well clear of the single-slot proof's range
  const hour = 60 * 60000;
  const slot = (offsetHours: number) => {
    const startsAt = new Date(base + offsetHours * hour);
    return { startsAt, endsAt: new Date(startsAt.getTime() + hour) };
  };

  const shared = slot(0); // the one slot both carts fight over
  const cartAOnly = [slot(2), slot(4)];
  const cartBOnly = [slot(6), slot(8)];

  const cartAKey = `cart-conflict-proof-A-${Date.now()}`;
  const cartBKey = `cart-conflict-proof-B-${Date.now()}`;

  console.log("\nFiring 2 concurrent 3-item carts sharing one overlapping slot...");

  const [resA, resB] = await Promise.allSettled([
    attemptCartBooking(pool, { tenantId, courtId, customerId, idempotencyKey: cartAKey, items: [shared, ...cartAOnly] }),
    attemptCartBooking(pool, { tenantId, courtId, customerId, idempotencyKey: cartBKey, items: [shared, ...cartBOnly] }),
  ]);

  const outcomes = { A: resA, B: resB };
  for (const [name, res] of Object.entries(outcomes)) {
    console.log(`Cart ${name}: ${res.status}${res.status === "rejected" ? ` (${(res as PromiseRejectedResult).reason?.code ?? "?"})` : ""}`);
  }

  const exactlyOneWon = (resA.status === "fulfilled") !== (resB.status === "fulfilled");

  // Direct DB check, not just trusting the promise outcomes — the loser's
  // BookingGroup row must not exist at all (proves the whole transaction
  // rolled back, not just the conflicting item). RLS is FORCED, so this
  // ad-hoc query needs app.tenant_id set transaction-locally same as every
  // other query here, not a bare pool.query().
  const checkClient = await pool.connect();
  let check;
  try {
    await checkClient.query("BEGIN");
    await checkClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    check = await checkClient.query(
      `SELECT bg.idempotency_key, count(b.id)::int AS item_count
       FROM booking_groups bg LEFT JOIN bookings b ON b.booking_group_id = bg.id
       WHERE bg.tenant_id = $1 AND bg.idempotency_key IN ($2, $3)
       GROUP BY bg.idempotency_key`,
      [tenantId, cartAKey, cartBKey]
    );
    await checkClient.query("COMMIT");
  } finally {
    checkClient.release();
  }
  const rowsByKey = new Map(check.rows.map((r) => [r.idempotency_key, r.item_count]));
  const winnerKey = resA.status === "fulfilled" ? cartAKey : cartBKey;
  const loserKey = resA.status === "fulfilled" ? cartBKey : cartAKey;
  const winnerHasThreeItems = rowsByKey.get(winnerKey) === 3;
  const loserHasNoGroup = !rowsByKey.has(loserKey);

  console.log("Exactly one cart won:", exactlyOneWon);
  console.log("Winner committed all 3 items:", winnerHasThreeItems, `(actual: ${rowsByKey.get(winnerKey) ?? 0})`);
  console.log("Loser has zero partial rows (no group row at all):", loserHasNoGroup);

  const pass = exactlyOneWon && winnerHasThreeItems && loserHasNoGroup;
  console.log(pass ? "PASS (cart conflict)" : "FAIL (cart conflict)");
  return pass;
}

async function attemptCartBooking(
  pool: Pool,
  args: { tenantId: string; courtId: string; customerId: string; idempotencyKey: string; items: { startsAt: Date; endsAt: Date }[] }
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [args.tenantId]);

    const groupRes = await client.query(
      `INSERT INTO booking_groups (id, tenant_id, customer_id, idempotency_key, total_minor, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 150000, now()) RETURNING id`,
      [args.tenantId, args.customerId, args.idempotencyKey]
    );
    const bookingGroupId = groupRes.rows[0].id;

    for (const item of args.items) {
      await client.query(
        `INSERT INTO bookings (id, tenant_id, booking_group_id, court_id, starts_at, ends_at, turnover_buffer_minutes, tz, duration_minutes, price_minor, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 10, 'Asia/Manila', 60, 50000, now())`,
        [args.tenantId, bookingGroupId, args.courtId, item.startsAt, item.endsAt]
      );
    }

    await client.query("COMMIT");
    return bookingGroupId;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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
