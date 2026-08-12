-- Phase C: sessions + otp_challenges tables (hand-rolled auth — see
-- notes.md 2026-08-12 for why Auth.js was not used). Idempotent throughout,
-- matching this connection's standing rule (migrate deploy is not atomic —
-- see 20260812100000's header comment).

CREATE TABLE IF NOT EXISTS "sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "UserKind" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "otp_challenges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sessions_tenant_id_user_id_idx" ON "sessions"("tenant_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_tenant_id_token_hash_key" ON "sessions"("tenant_id", "token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "otp_challenges_tenant_id_email_hash_purpose_key" ON "otp_challenges"("tenant_id", "email_hash", "purpose");

DO $$ BEGIN
  ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS: same tenant_isolation pattern as every other tenant-scoped table.
-- Unlike tenant_domains, there is no circular-dependency problem here —
-- both sessions and otp_challenges are only ever looked up AFTER the
-- tenant is already resolved via the hostname (resolveTenant()), which
-- itself has its own unscoped SELECT policy.
DO $$
DECLARE
  t text;
  new_tenant_scoped_tables text[] := ARRAY['sessions', 'otp_challenges'];
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
