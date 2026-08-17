-- Drop the leftover DEFAULT on discounts.updated_at so it matches Prisma's
-- @updatedAt model (app-managed, no DB default) — keeps `migrate diff` clean.
ALTER TABLE "discounts" ALTER COLUMN "updated_at" DROP DEFAULT;
