-- Adds Court.imageUrl — a customer-facing court photo, shown when a customer
-- clicks a court header on the booking grid. Nullable, no backfill needed.
ALTER TABLE "courts" ADD COLUMN "image_url" TEXT;
