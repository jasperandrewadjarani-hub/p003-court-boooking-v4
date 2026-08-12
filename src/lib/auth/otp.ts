import "server-only";
import { createHash, randomUUID } from "crypto";
import { withTenant } from "@/lib/tenant/withTenant";

// Direct port of v2's Auth.js sendCustomerChallenge_/verifyCustomerChallenge_
// — 8-char uppercase code, hashed at rest, 15-min expiry, 8-attempt cap —
// onto the otp_challenges table instead of PropertiesService.

const OTP_MINUTES = 15;
const MAX_ATTEMPTS = 8;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(email: string): string {
  const normalized = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Enter a valid email address.");
  return normalized;
}

function generateCode(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

export type OtpPurpose = "register" | "reset";

/** Issues a new challenge (or reports one is already outstanding), enqueues
 * the delivery email. Returns the raw code ONLY for the dev-mode email
 * transport to surface — never returned in a production path (see email/send.ts). */
export async function sendOtpChallenge(
  tenantId: string,
  email: string,
  purpose: OtpPurpose
): Promise<{ alreadySent: boolean; code?: string; expiresAt: Date }> {
  const normalized = normalizeEmail(email);
  const emailHash = sha256(normalized);

  return withTenant(tenantId, async (tx) => {
    const existing = await tx.otpChallenge.findUnique({
      where: { tenantId_emailHash_purpose: { tenantId, emailHash, purpose } },
    });
    if (existing && existing.expiresAt > new Date()) {
      return { alreadySent: true, expiresAt: existing.expiresAt };
    }

    const code = generateCode();
    const codeHash = sha256(code);
    const expiresAt = new Date(Date.now() + OTP_MINUTES * 60_000);

    if (existing) {
      await tx.otpChallenge.update({
        where: { id: existing.id },
        data: { codeHash, attempts: 0, expiresAt },
      });
    } else {
      await tx.otpChallenge.create({
        data: { tenantId, emailHash, purpose, codeHash, expiresAt },
      });
    }

    return { alreadySent: false, code, expiresAt };
  });
}

/** Verifies a code; throws on expiry/attempt-cap/mismatch, deletes the
 * challenge on success (one-time use, matching v2). */
export async function verifyOtpChallenge(tenantId: string, email: string, purpose: OtpPurpose, code: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const emailHash = sha256(normalized);

  await withTenant(tenantId, async (tx) => {
    const record = await tx.otpChallenge.findUnique({
      where: { tenantId_emailHash_purpose: { tenantId, emailHash, purpose } },
    });
    if (!record || record.expiresAt <= new Date()) {
      throw new Error("Your verification code has expired. Request a new one.");
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      throw new Error("Too many incorrect attempts. Request a new code.");
    }
    if (sha256(String(code || "").trim().toUpperCase()) !== record.codeHash) {
      await tx.otpChallenge.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      throw new Error("Incorrect verification code. Please try again.");
    }
    await tx.otpChallenge.delete({ where: { id: record.id } });
  });
}

export { normalizeEmail };
