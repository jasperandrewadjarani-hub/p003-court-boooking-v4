-- Add GoTyme (PH digital bank) as an admin-side payment method.
-- Idempotent (see notes.md gotcha 11): ADD VALUE IF NOT EXISTS.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'gotyme';
