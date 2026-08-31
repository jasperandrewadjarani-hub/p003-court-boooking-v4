-- Add a third promo-discount type: a fixed peso amount off PER SLOT (per booked
-- hour), as opposed to fixed_php (once per checkout) or percentage. Powers the
-- "first 50 online bookers — ₱100 off per slot" launch promo.
--
-- Idempotent: ADD VALUE IF NOT EXISTS is safe to re-run (see notes.md gotcha
-- 11 — migrate deploy here is not atomic per file, so every migration must be
-- individually re-runnable). Postgres 12+ permits ADD VALUE inside a
-- transaction as long as the new value is not USED in the same transaction;
-- this migration only declares it.
ALTER TYPE "DiscountType" ADD VALUE IF NOT EXISTS 'fixed_php_per_slot';
