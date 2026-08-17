-- v3b parity: replace the unwired Promo model with a v3b-faithful Discount
-- model (0=unlimited, no date bounds), add BlockedSlot, and add group-level
-- discount fields to booking_groups. Fully idempotent per this Supabase
-- connection's standing rule (migrate deploy is not atomic here — see
-- 20260812100000's header).

-- 1. New enum (idempotent)
DO $$ BEGIN
  CREATE TYPE "DiscountType" AS ENUM ('percentage', 'fixed_php');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. booking_groups: drop the promo FK + column FIRST (the promos table
-- can't be dropped while this FK depends on it), then add discount fields.
ALTER TABLE "booking_groups" DROP CONSTRAINT IF EXISTS "booking_groups_promo_id_fkey";
ALTER TABLE "booking_groups" DROP COLUMN IF EXISTS "promo_id";
ALTER TABLE "booking_groups" ADD COLUMN IF NOT EXISTS "discount_amount_minor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "booking_groups" ADD COLUMN IF NOT EXISTS "discount_code" TEXT;
ALTER TABLE "booking_groups" ADD COLUMN IF NOT EXISTS "discount_id" UUID;

-- 3. Drop the old promo tables/enum (now safe — no more dependents)
DROP TABLE IF EXISTS "promo_redemptions";
DROP TABLE IF EXISTS "promos";
DROP TYPE IF EXISTS "PromoDiscountType";

-- 4. New tables (idempotent)
CREATE TABLE IF NOT EXISTS "discounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "discount_type" "DiscountType" NOT NULL,
    "discount_value" INTEGER NOT NULL,
    "max_availments" INTEGER NOT NULL DEFAULT 0,
    "times_availed" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "blocked_slots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "court_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blocked_slots_pkey" PRIMARY KEY ("id")
);

-- 5. Indexes (idempotent)
CREATE INDEX IF NOT EXISTS "discounts_tenant_id_active_idx" ON "discounts"("tenant_id", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "discounts_tenant_id_code_key" ON "discounts"("tenant_id", "code");
CREATE INDEX IF NOT EXISTS "blocked_slots_tenant_id_local_date_court_id_idx" ON "blocked_slots"("tenant_id", "local_date", "court_id");

-- 6. Foreign keys (idempotent via duplicate_object catch)
DO $$ BEGIN
  ALTER TABLE "booking_groups" ADD CONSTRAINT "booking_groups_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "discounts" ADD CONSTRAINT "discounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "blocked_slots" ADD CONSTRAINT "blocked_slots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "blocked_slots" ADD CONSTRAINT "blocked_slots_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 7. RLS on the two new tenant-scoped tables (same forced tenant_isolation
-- pattern as every other tenant-scoped table — Prisma's diff omits this).
DO $$
DECLARE
  t text;
  new_tenant_scoped_tables text[] := ARRAY['discounts', 'blocked_slots'];
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
