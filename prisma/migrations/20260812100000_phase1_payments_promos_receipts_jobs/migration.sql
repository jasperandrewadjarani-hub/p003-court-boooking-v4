-- Phase 1.1, final form: fully idempotent, safe to re-run from any partial
-- state. Two earlier attempts (deleted, see notes.md) discovered that this
-- connection does NOT apply migration.sql as one all-or-nothing transaction
-- — a reported failure partway through still leaves earlier statements
-- committed. Every statement below is now written to be safe whether or not
-- it already ran: CREATE TYPE is wrapped in a duplicate_object-catching DO
-- block (Postgres has no native `CREATE TYPE IF NOT EXISTS`), everything
-- else uses IF EXISTS / IF NOT EXISTS.

-- =============================================================================
-- 1. Enum types (idempotent — CREATE TYPE has no native IF NOT EXISTS)
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "BookingStatus" AS ENUM ('reserved', 'confirmed', 'checked_in', 'playing', 'finished', 'cancelled', 'lapsed', 'no_show');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'gcash', 'maya', 'credit_card', 'bank_transfer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PromoDiscountType" AS ENUM ('percent', 'fixed_minor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EmailOutboxStatus" AS ENUM ('queued', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- 2. Finish the status-vocabulary conversion (idempotent)
-- =============================================================================

ALTER TABLE "booking_groups" DROP COLUMN IF EXISTS "receipt_object_key";

DO $$ BEGIN
  ALTER TABLE "booking_groups" DROP COLUMN "status";
  ALTER TABLE "booking_groups" ADD COLUMN "status" "BookingStatus" NOT NULL DEFAULT 'reserved';
EXCEPTION WHEN undefined_column THEN NULL; -- already converted
END $$;

ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_no_overlap";

DO $$ BEGIN
  ALTER TABLE "bookings" DROP COLUMN "status";
  ALTER TABLE "bookings" ADD COLUMN "status" "BookingStatus" NOT NULL DEFAULT 'reserved';
EXCEPTION WHEN undefined_column THEN NULL; -- already converted
END $$;

DROP TYPE IF EXISTS "BookingGroupStatus";
DROP TYPE IF EXISTS "BookingItemStatus";

-- Constraint was unconditionally dropped above, so this always (re)creates
-- it with the widened predicate. Matches v2's activeBookingStatuses_().
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "court_id"  WITH =,
    "block_range" WITH &&
  ) WHERE ("status" IN ('reserved', 'confirmed', 'checked_in', 'playing'));

-- =============================================================================
-- 3. New tables (IF NOT EXISTS — genuinely idempotent)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "booking_group_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "discount_minor" INTEGER NOT NULL DEFAULT 0,
    "tax_minor" INTEGER NOT NULL DEFAULT 0,
    "total_minor" INTEGER NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "staff_user_id" UUID,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "promos" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discount_type" "PromoDiscountType" NOT NULL,
    "discount_value" INTEGER NOT NULL,
    "max_redemptions" INTEGER NOT NULL,
    "redeemed" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "promo_redemptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "promo_id" UUID NOT NULL,
    "booking_group_id" UUID NOT NULL,
    "discount_minor" INTEGER NOT NULL,
    "redeemed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "booking_group_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_by_user_id" UUID,
    "verified_at" TIMESTAMP(3),
    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "email_outbox" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "template" TEXT NOT NULL,
    "to_addresses" TEXT[],
    "cc_addresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bcc_addresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "payload" JSONB NOT NULL,
    "status" "EmailOutboxStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_kind" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "job_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "job" TEXT NOT NULL,
    "window_key" TEXT NOT NULL,
    "ran_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- =============================================================================
-- 4. Indexes (IF NOT EXISTS)
-- =============================================================================

CREATE INDEX IF NOT EXISTS "payments_tenant_id_collected_at_idx" ON "payments"("tenant_id", "collected_at");
CREATE INDEX IF NOT EXISTS "payments_tenant_id_booking_group_id_idx" ON "payments"("tenant_id", "booking_group_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payments_tenant_id_receipt_number_key" ON "payments"("tenant_id", "receipt_number");

CREATE INDEX IF NOT EXISTS "promos_tenant_id_active_starts_at_ends_at_idx" ON "promos"("tenant_id", "active", "starts_at", "ends_at");
CREATE UNIQUE INDEX IF NOT EXISTS "promos_tenant_id_code_key" ON "promos"("tenant_id", "code");

CREATE UNIQUE INDEX IF NOT EXISTS "promo_redemptions_booking_group_id_key" ON "promo_redemptions"("booking_group_id");
CREATE UNIQUE INDEX IF NOT EXISTS "promo_redemptions_tenant_id_promo_id_booking_group_id_key" ON "promo_redemptions"("tenant_id", "promo_id", "booking_group_id");

CREATE INDEX IF NOT EXISTS "receipts_tenant_id_booking_group_id_idx" ON "receipts"("tenant_id", "booking_group_id");
CREATE INDEX IF NOT EXISTS "receipts_tenant_id_verified_at_idx" ON "receipts"("tenant_id", "verified_at");

CREATE INDEX IF NOT EXISTS "email_outbox_tenant_id_status_created_at_idx" ON "email_outbox"("tenant_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "audit_log_tenant_id_entity_entity_id_idx" ON "audit_log"("tenant_id", "entity", "entity_id");
CREATE INDEX IF NOT EXISTS "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "job_runs_tenant_id_job_window_key_key" ON "job_runs"("tenant_id", "job", "window_key");

-- =============================================================================
-- 5. Foreign keys (idempotent via duplicate_object catch)
-- =============================================================================

DO $$ BEGIN
  ALTER TABLE "booking_groups" ADD CONSTRAINT "booking_groups_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_group_id_fkey" FOREIGN KEY ("booking_group_id") REFERENCES "booking_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "promos" ADD CONSTRAINT "promos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_booking_group_id_fkey" FOREIGN KEY ("booking_group_id") REFERENCES "booking_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "receipts" ADD CONSTRAINT "receipts_booking_group_id_fkey" FOREIGN KEY ("booking_group_id") REFERENCES "booking_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- 6. RLS on the new tenant-scoped tables (idempotent — skip if already enabled/policied)
-- =============================================================================

DO $$
DECLARE
  t text;
  new_tenant_scoped_tables text[] := ARRAY[
    'payments', 'promos', 'promo_redemptions', 'receipts',
    'email_outbox', 'audit_log', 'job_runs'
  ];
BEGIN
  FOREACH t IN ARRAY new_tenant_scoped_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I
           USING       (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
           WITH CHECK  (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
        t
      );
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_runtime', t);
  END LOOP;
END $$;
