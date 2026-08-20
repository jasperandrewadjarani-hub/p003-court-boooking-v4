-- Per-court pricing: price_matrix rules now target a specific court instead of
-- a court TYPE (indoor/outdoor). Clients price courts individually (surface,
-- VIP feel, etc.), so each rule carries a court_id.

-- 1) New column + FK (nullable so the backfill can run; the app treats it as required).
ALTER TABLE "price_matrix" ADD COLUMN IF NOT EXISTS "court_id" UUID;
DO $$ BEGIN
  ALTER TABLE "price_matrix"
    ADD CONSTRAINT "price_matrix_court_id_fkey"
    FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) court_type becomes optional (legacy column, no longer used by the engine).
ALTER TABLE "price_matrix" ALTER COLUMN "court_type" DROP NOT NULL;

-- 3) Backfill: expand each existing court_type rule into one rule per matching
--    court, so current pricing is preserved exactly. Only rows that haven't been
--    assigned a court yet (court_id IS NULL) are expanded.
INSERT INTO "price_matrix" ("id", "tenant_id", "court_id", "day_type", "start_time", "end_time", "court_type", "price_per_hour_minor")
SELECT gen_random_uuid(), pm."tenant_id", c."id", pm."day_type", pm."start_time", pm."end_time", pm."court_type", pm."price_per_hour_minor"
FROM "price_matrix" pm
JOIN "courts" c
  ON c."tenant_id" = pm."tenant_id"
 AND ( (pm."court_type" = 'indoor'  AND c."indoor" = true)
    OR (pm."court_type" = 'outdoor' AND c."indoor" = false) )
WHERE pm."court_id" IS NULL;

-- 4) Drop the old court-type-only rows (their per-court copies now exist).
DELETE FROM "price_matrix" WHERE "court_id" IS NULL;

-- 5) Index to match the new lookup shape.
DROP INDEX IF EXISTS "price_matrix_tenant_id_day_type_court_type_idx";
CREATE INDEX IF NOT EXISTS "price_matrix_tenant_id_court_id_day_type_idx"
  ON "price_matrix" ("tenant_id", "court_id", "day_type");
