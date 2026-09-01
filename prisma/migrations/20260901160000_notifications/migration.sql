-- In-app notifications (bell) for staff + customers. Tenant-scoped + RLS, same
-- forced tenant_isolation pattern as every other tenant-scoped table. Fully
-- idempotent (migrate deploy is not atomic on this connection).

CREATE TABLE IF NOT EXISTS "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "audience" TEXT NOT NULL,
    "customer_id" UUID,
    "type" TEXT NOT NULL,
    "booking_group_id" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notifications_tenant_audience_idx" ON "notifications"("tenant_id", "audience", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "notifications_tenant_customer_idx" ON "notifications"("tenant_id", "customer_id", "created_at" DESC);

DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text := 'notifications';
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'tenant_isolation') THEN
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING       (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
         WITH CHECK  (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
  END IF;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_runtime', t);
END $$;
