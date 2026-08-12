-- Fixes a real, empirically-discovered bug: every DateTime field in the
-- schema was mapped to Postgres `timestamp` (no time zone) instead of
-- `timestamptz`, because Prisma's default Postgres mapping for a bare
-- `DateTime` field is the naive type unless @db.Timestamptz is explicit.
--
-- Consequence: the booking_constraints_and_rls trigger's
-- `(starts_at AT TIME ZONE tz)::date` computed the WRONG direction — for a
-- `timestamp` (naive) column, `AT TIME ZONE zone` means "interpret this
-- naive value AS wall-clock time in `zone` and convert TO UTC" (the
-- opposite of the intended "convert this UTC instant TO wall-clock time in
-- `zone`", which is what `AT TIME ZONE` means for an actual `timestamptz`
-- column). Discovered via a real booking made through the browser landing
-- on the wrong local_date, traced through 6 rounds of isolated
-- reproduction (see notes.md, 2026-08-12) before finding the root cause in
-- `information_schema.columns`.
--
-- SET DATA TYPE TIMESTAMPTZ on a naive `timestamp` column performs an
-- implicit cast that interprets the existing naive value using the
-- session's current `timezone` setting. Every value in these columns was
-- always written as a literal UTC instant (application code used
-- `...Z`-suffixed dates throughout), so casting under a UTC session
-- correctly reinterprets them as the UTC instants they already represent —
-- no data is changed in meaning, only the column's declared type.
--
-- Idempotent: re-applying SET DATA TYPE TIMESTAMPTZ(3) to an
-- already-TIMESTAMPTZ(3) column is a harmless no-op.

SET timezone = 'UTC';

ALTER TABLE "audit_log" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);

ALTER TABLE "booking_groups" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3),
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

ALTER TABLE "bookings" ALTER COLUMN "starts_at" SET DATA TYPE TIMESTAMPTZ(3),
  ALTER COLUMN "ends_at" SET DATA TYPE TIMESTAMPTZ(3),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3),
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

ALTER TABLE "customers" ALTER COLUMN "registered_at" SET DATA TYPE TIMESTAMPTZ(3);

ALTER TABLE "email_outbox" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3),
  ALTER COLUMN "sent_at" SET DATA TYPE TIMESTAMPTZ(3);

ALTER TABLE "job_runs" ALTER COLUMN "ran_at" SET DATA TYPE TIMESTAMPTZ(3);

ALTER TABLE "payments" ALTER COLUMN "collected_at" SET DATA TYPE TIMESTAMPTZ(3);

ALTER TABLE "promo_redemptions" ALTER COLUMN "redeemed_at" SET DATA TYPE TIMESTAMPTZ(3);

ALTER TABLE "promos" ALTER COLUMN "starts_at" SET DATA TYPE TIMESTAMPTZ(3),
  ALTER COLUMN "ends_at" SET DATA TYPE TIMESTAMPTZ(3),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);

ALTER TABLE "receipts" ALTER COLUMN "uploaded_at" SET DATA TYPE TIMESTAMPTZ(3),
  ALTER COLUMN "verified_at" SET DATA TYPE TIMESTAMPTZ(3);

ALTER TABLE "tenant_domains" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);

ALTER TABLE "tenant_settings" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

ALTER TABLE "tenants" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3),
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

ALTER TABLE "users" ALTER COLUMN "email_verified_at" SET DATA TYPE TIMESTAMPTZ(3),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3),
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

-- The trigger's derived-value computation is unchanged in wording (still
-- `NEW.starts_at AT TIME ZONE NEW.tz`) but now correct in behavior, since
-- starts_at is finally a real timestamptz. block_range was never affected
-- by this bug (tstzrange()/interval arithmetic doesn't involve AT TIME
-- ZONE), but local_date was computed backwards for every row written
-- before this fix. Force the BEFORE UPDATE trigger to re-fire and
-- recompute both from the now-correct column type, rather than
-- duplicating its logic here by hand.
UPDATE "bookings" SET "id" = "id";
