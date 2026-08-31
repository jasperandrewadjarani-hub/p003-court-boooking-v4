-- Total peso-budget cap for a discount code: once the cumulative discount
-- given (total_discounted_minor) would exceed max_total_discount_minor, the
-- code stops — independent of the max_availments count cap. Powers e.g.
-- "first 50 bookers, PHP 100/slot, but at most PHP 5,000 given in total".
--
-- Idempotent (see notes.md gotcha 11): ADD COLUMN IF NOT EXISTS.
ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "max_total_discount_minor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "total_discounted_minor" INTEGER NOT NULL DEFAULT 0;
