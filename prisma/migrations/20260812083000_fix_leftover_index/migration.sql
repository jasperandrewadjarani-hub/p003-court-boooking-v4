-- Fixes two mistakes in booking_constraints_and_rls (already applied):
--
-- 1. Prisma's @@unique([tenantId, email]) on `users` created a plain
--    CREATE UNIQUE INDEX, not a table CONSTRAINT. The previous migration's
--    `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tenant_id_email_key`
--    therefore matched nothing and silently no-op'd, leaving the old
--    case-sensitive index alongside the new case-insensitive one. Confirmed
--    via `prisma migrate diff --from-config-datasource --to-schema` against
--    the live database, not guessed.
DROP INDEX IF EXISTS "users_tenant_id_email_key";

-- 2. The manual `bookings_tenant_id_status_court_id_block_range_idx` GiST
--    index was redundant: `ADD CONSTRAINT bookings_no_overlap EXCLUDE USING
--    gist (tenant_id, court_id, block_range)` already creates its own
--    backing GiST index over exactly those columns, usable by the planner
--    for the same overlap probes. Dropping the duplicate.
DROP INDEX IF EXISTS "bookings_tenant_id_status_court_id_block_range_idx";
