/**
 * Phase 1.4 gate (master plan §8, §4.5): 500 concurrent redemption attempts
 * against a promo with max_redemptions=100 must produce exactly 100
 * successful redemptions with exactly 100 matching ledger rows, and the
 * other 400 must resolve cleanly as "exhausted" (0 rows returned from the
 * UPDATE) — never an error, never an over-redemption.
 *
 * This is the "first 100 bookings" pattern's own proof: an application-level
 * check-then-write here would race under load; the atomic
 * `UPDATE ... WHERE redeemed < max_redemptions RETURNING redeemed` cannot
 * over-redeem no matter how many requests arrive simultaneously, because
 * every UPDATE against the same row serializes at the database regardless
 * of application-level concurrency.
 *
 * Run with: npx tsx scripts/promo-counter-proof.ts
 */
import { Pool } from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const ATTEMPTS = 500;
const MAX_REDEMPTIONS = 100;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 55 });
  const bootstrap = new Pool({ connectionString: process.env.DIRECT_URL });

  const tenantRes = await bootstrap.query(`SELECT id FROM tenants WHERE slug = 'dink-and-dunk'`);
  if (!tenantRes.rows.length) throw new Error("Seed the dink-and-dunk tenant first (npx prisma db seed)");
  const tenantId = tenantRes.rows[0].id;

  let customerRes = await bootstrap.query(`SELECT id FROM customers WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  let customerId: string;
  if (customerRes.rows.length) {
    customerId = customerRes.rows[0].id;
  } else {
    const userRes = await bootstrap.query(
      `INSERT INTO users (id, tenant_id, kind, email, updated_at) VALUES (gen_random_uuid(), $1, 'customer', 'promo-proof@example.test', now()) RETURNING id`,
      [tenantId]
    );
    const newCustomer = await bootstrap.query(
      `INSERT INTO customers (id, tenant_id, user_id, first_name, last_name) VALUES (gen_random_uuid(), $1, $2, 'Promo', 'Proof') RETURNING id`,
      [tenantId, userRes.rows[0].id]
    );
    customerId = newCustomer.rows[0].id;
  }

  const code = `PROOF-${Date.now()}`;
  const promoRes = await bootstrap.query(
    `INSERT INTO promos (id, tenant_id, name, code, discount_type, discount_value, max_redemptions, starts_at, ends_at)
     VALUES (gen_random_uuid(), $1, 'Concurrency Proof Promo', $2, 'percent', 20, $3, now() - interval '1 day', now() + interval '1 day')
     RETURNING id`,
    [tenantId, code, MAX_REDEMPTIONS]
  );
  const promoId = promoRes.rows[0].id;
  await bootstrap.end();

  console.log(`Firing ${ATTEMPTS} concurrent redemption attempts against a promo with max_redemptions=${MAX_REDEMPTIONS}...`);

  const attempts = Array.from({ length: ATTEMPTS }, (_, i) =>
    attemptRedemption(pool, { tenantId, promoId, customerId, idempotencyKey: `promo-proof-${Date.now()}-${i}` })
  );

  const results = await Promise.allSettled(attempts);

  let redeemed = 0;
  let exhausted = 0;
  const errors: string[] = [];

  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value === "redeemed") redeemed++;
      else exhausted++;
    } else {
      errors.push(`${r.reason?.code ?? "?"}: ${r.reason?.message ?? r.reason}`);
    }
  }

  // Independent check: the ledger table, not just what the script counted.
  const verify = new Pool({ connectionString: process.env.DIRECT_URL });
  const ledgerCount = await verify.query(`SELECT count(*) FROM promo_redemptions WHERE promo_id = $1`, [promoId]);
  const finalPromoRow = await verify.query(`SELECT redeemed FROM promos WHERE id = $1`, [promoId]);
  await verify.end();

  console.log("\n--- Results ---");
  console.log("Script-counted redemptions:", redeemed, "(expected:", MAX_REDEMPTIONS, ")");
  console.log("Script-counted exhausted (no discount, not an error):", exhausted, "(expected:", ATTEMPTS - MAX_REDEMPTIONS, ")");
  console.log("Errors:", errors.length, "(expected: 0)");
  console.log("Ledger rows (promo_redemptions):", ledgerCount.rows[0].count, "(expected:", MAX_REDEMPTIONS, ")");
  console.log("Final promos.redeemed column:", finalPromoRow.rows[0].redeemed, "(expected:", MAX_REDEMPTIONS, ")");
  if (errors.length) console.log("Error details:", errors.slice(0, 5));

  const pass =
    redeemed === MAX_REDEMPTIONS &&
    exhausted === ATTEMPTS - MAX_REDEMPTIONS &&
    errors.length === 0 &&
    Number(ledgerCount.rows[0].count) === MAX_REDEMPTIONS &&
    finalPromoRow.rows[0].redeemed === MAX_REDEMPTIONS;

  console.log(pass ? "\nPASS" : "\nFAIL");
  await pool.end();
  process.exit(pass ? 0 : 1);
}

async function attemptRedemption(
  pool: Pool,
  args: { tenantId: string; promoId: string; customerId: string; idempotencyKey: string }
): Promise<"redeemed" | "exhausted"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [args.tenantId]);

    const groupRes = await client.query(
      `INSERT INTO booking_groups (id, tenant_id, customer_id, idempotency_key, total_minor, promo_id, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 40000, $4, now()) RETURNING id`,
      [args.tenantId, args.customerId, args.idempotencyKey, args.promoId]
    );
    const bookingGroupId = groupRes.rows[0].id;

    // The atomic counter (master plan §4.5) — validity window checked in
    // the same statement so an expired/inactive promo can't slip through.
    const counterRes = await client.query(
      `UPDATE promos SET redeemed = redeemed + 1
       WHERE id = $1 AND tenant_id = $2 AND redeemed < max_redemptions
         AND active AND now() BETWEEN starts_at AND ends_at
       RETURNING redeemed`,
      [args.promoId, args.tenantId]
    );

    let outcome: "redeemed" | "exhausted" = "exhausted";
    if (counterRes.rows.length > 0) {
      await client.query(
        `INSERT INTO promo_redemptions (id, tenant_id, promo_id, booking_group_id, discount_minor)
         VALUES (gen_random_uuid(), $1, $2, $3, 8000)`,
        [args.tenantId, args.promoId, bookingGroupId]
      );
      outcome = "redeemed";
    }

    await client.query("COMMIT");
    return outcome;
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
