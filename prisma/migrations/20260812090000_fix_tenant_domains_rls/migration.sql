-- Fixes a real design bug found by testing (not by inspection): the generic
-- tenant_isolation policy applied to EVERY tenant-scoped table in the
-- booking_constraints_and_rls migration is circular on tenant_domains —
-- resolving "which tenant does this hostname belong to" is exactly the
-- operation that determines app.tenant_id, so requiring app.tenant_id to
-- already be set before you can read tenant_domains makes tenant
-- resolution impossible. Confirmed by switching the app to app_runtime and
-- watching every hostname report "No tenant bound", including ones that
-- genuinely have a tenant.
--
-- Fix: SELECT on tenant_domains is not tenant-scoped (this is discoverable
-- information anyway — anyone can learn "this hostname serves tenant X" by
-- visiting the hostname). Writes remain tenant-scoped, matching the
-- original design intent for when platform-admin domain management exists.

DROP POLICY IF EXISTS "tenant_isolation" ON "tenant_domains";

CREATE POLICY "tenant_domains_select_all" ON "tenant_domains"
  FOR SELECT
  USING (true);

CREATE POLICY "tenant_domains_write_scoped" ON "tenant_domains"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "tenant_domains_update_scoped" ON "tenant_domains"
  FOR UPDATE
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "tenant_domains_delete_scoped" ON "tenant_domains"
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
