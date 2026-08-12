-- Raw-SQL migration layered on top of the Prisma-generated `init` migration.
-- Not expressible in the Prisma schema DSL — see schema.prisma's header
-- comment. Reference: P_003_V4MasterPlan_(2026-08).md §4.2, §4.3, §5.1.

-- =============================================================================
-- 1. No double-booking (§4.2) — GiST exclusion constraint + derived-column trigger
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings" ADD COLUMN "block_range" tstzrange;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_time_valid" CHECK ("ends_at" > "starts_at"),
  ADD CONSTRAINT "bookings_block_lower" CHECK (lower("block_range") = "starts_at"),
  ADD CONSTRAINT "bookings_block_upper" CHECK (upper("block_range") >= "ends_at");

-- A trigger, not a GENERATED column: timestamptz + interval and timezone
-- conversion have volatility markings that make GENERATED ALWAYS AS ...
-- STORED fragile across Postgres versions. See master plan §4.2 for why.
CREATE FUNCTION bookings_set_derived() RETURNS trigger AS $$
BEGIN
  NEW.block_range := tstzrange(
      NEW.starts_at,
      NEW.ends_at + make_interval(mins => NEW.turnover_buffer_minutes),
      '[)');
  NEW.local_date := (NEW.starts_at AT TIME ZONE NEW.tz)::date;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_set_derived_trigger
  BEFORE INSERT OR UPDATE ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION bookings_set_derived();

-- Partial predicate matches v2's activeBookingStatuses_() exactly: cancelled,
-- lapsed, finished, and no_show rows never block a slot.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "court_id"  WITH =,
    "block_range" WITH &&
  ) WHERE ("status" = 'active');
-- Note: v4's Phase-0 `BookingItemStatus` enum is {active, cancelled}; the
-- full {reserved, confirmed, checked_in, playing, finished, cancelled,
-- lapsed, no_show} vocabulary lives on booking_groups (BookingGroupStatus)
-- and lands on bookings itself in Phase 1 alongside the booking transaction
-- (master plan §4.4) — this predicate will be widened to match at that point.

-- =============================================================================
-- 2. Booking-ID index support (§4.3) — functional unique indexes Prisma can't express
-- =============================================================================

CREATE UNIQUE INDEX "tenant_domains_hostname_lower_key" ON "tenant_domains" (lower("hostname"));
DROP INDEX IF EXISTS "tenant_domains_hostname_key"; -- superseded by the case-insensitive index above

CREATE UNIQUE INDEX "users_tenant_id_email_lower_key" ON "users" ("tenant_id", lower("email"));
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_tenant_id_email_key"; -- superseded, was case-sensitive

-- ("tenant_id", "local_date", "court_id") already exists — created by
-- Prisma's @@index([tenantId, localDate, courtId]) in the init migration.
CREATE INDEX "bookings_tenant_id_status_court_id_block_range_idx" ON "bookings" USING gist ("tenant_id", "court_id", "block_range");

-- =============================================================================
-- 3. app_runtime role (§5.1) — the application connects as this, never as owner
-- =============================================================================
-- Idempotent: `CREATE ROLE IF NOT EXISTS` doesn't exist in Postgres, so guard
-- with a catalog check (this migration must be safe to reason about even if
-- the role was pre-provisioned by a DBA before Prisma ever ran).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime WITH LOGIN PASSWORD NULL NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

-- The actual login password for app_runtime is set out-of-band (Supabase
-- dashboard or a one-time `ALTER ROLE ... PASSWORD`), never committed here.
-- DATABASE_URL / DIRECT_URL in .env* connect as the table owner until that's
-- done — tracked as a Phase-0 follow-up in notes.md, not silently assumed.

-- =============================================================================
-- 4. Row-Level Security — forced, fail-closed, one policy per tenant-scoped table
-- =============================================================================

DO $$
DECLARE
  t text;
  tenant_scoped_tables text[] := ARRAY[
    'tenant_domains', 'tenant_settings', 'users', 'customers', 'staff',
    'courts', 'memberships', 'price_matrix', 'holidays',
    'booking_groups', 'bookings', 'booking_sequences'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_scoped_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t); -- applies to the table owner too
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING       (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
         WITH CHECK  (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;

-- current_setting('app.tenant_id', true) returns NULL when unset, and
-- `tenant_id = NULL` is never true — an unscoped query matches zero rows in
-- every tenant table. Isolation fails closed. Verified by the isolation test
-- suite (master plan §5.1 layer 3), not just asserted here.
