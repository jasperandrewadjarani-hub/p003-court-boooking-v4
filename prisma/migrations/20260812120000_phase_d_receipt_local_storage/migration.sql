-- Phase D: adds a local-storage fallback column for receipt bytes. No
-- Supabase Storage credentials (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)
-- exist in .env.local yet — same $0-test-phase situation as Resend for
-- email (see notes.md 2026-08-12). Real Storage upload is a drop-in swap
-- once those credentials exist (src/lib/storage/receipts.ts).

ALTER TABLE "receipts" ADD COLUMN IF NOT EXISTS "data" BYTEA;
