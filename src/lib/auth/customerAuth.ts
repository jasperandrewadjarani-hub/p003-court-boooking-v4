"use server";

import { withTenant } from "@/lib/tenant/withTenant";
import { resolveTenant } from "@/lib/tenant/resolve";
import { hashPassword, verifyPassword, validatePassword } from "@/lib/auth/password";
import { sendOtpChallenge, verifyOtpChallenge, normalizeEmail } from "@/lib/auth/otp";
import { issueSession, verifySession, clearSession } from "@/lib/auth/session";
import { enqueueEmail } from "@/lib/email/send";
import { getEmailTransportMode } from "@/lib/email/transport";

const CUSTOMER_SESSION_HOURS = 6;

/** Direct port of v2's beginCustomerBookingAuth: an email with a verified,
 * password-protected account is a login; anything else starts registration
 * (sends an OTP). NOTE — no login-attempt rate limiting yet (v2 had a
 * 10-attempts/15-min cache counter); deferred to Phase F alongside the
 * Upstash-backed hardening the master plan already calls for there. */
export async function beginCustomerBookingAuth(email: string) {
  const tenant = await resolveTenant();
  const normalized = normalizeEmail(email);

  const existing = await withTenant(tenant.id, (tx) =>
    tx.$queryRaw<{ id: string; password_hash: string | null; email_verified_at: Date | null }[]>`
      SELECT id, password_hash, email_verified_at FROM users
      WHERE tenant_id = ${tenant.id}::uuid AND kind = 'customer' AND lower(email) = ${normalized} LIMIT 1
    `
  );

  if (existing.length && existing[0].password_hash && existing[0].email_verified_at) {
    return { mode: "login" as const, email: normalized };
  }

  const result = await sendOtpChallenge(tenant.id, normalized, "register");
  const delivery = await deliverOtp(tenant.id, normalized, "register", result);
  return { mode: "register" as const, email: normalized, ...delivery };
}

async function deliverOtp(
  tenantId: string,
  email: string,
  purpose: "register" | "reset",
  result: { alreadySent: boolean; code?: string; expiresAt: Date }
) {
  const transport = getEmailTransportMode();
  const subject = purpose === "reset" ? "Reset your password" : "Verify your new account";

  if (!result.alreadySent && result.code) {
    await withTenant(tenantId, (tx) =>
      enqueueEmail(tx, tenantId, `otp_${purpose}`, email, { code: result.code, subject })
    );
  }

  if (transport === "console") {
    // Dev-mode fallback (no Resend account/domain configured yet) — the
    // code is surfaced directly to the caller, never silently "sent".
    console.log(`[DEV EMAIL] ${subject} for ${email}: ${result.code ?? "(already sent, unchanged)"}`);
    return { alreadySent: result.alreadySent, expiresAt: result.expiresAt, devMode: true as const, devCode: result.code };
  }

  // Real Resend transport — not wired until Phase F. Fail loudly rather
  // than silently pretending an email went out.
  throw new Error("Real email delivery (Resend) isn't wired up yet — set EMAIL_TRANSPORT=console for now.");
}

export async function registerCustomerAccount(input: {
  email: string;
  code: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
}) {
  const tenant = await resolveTenant();
  const normalized = normalizeEmail(input.email);
  validatePassword(input.password);
  await verifyOtpChallenge(tenant.id, normalized, "register", input.code);

  const passwordHash = await hashPassword(input.password);

  const customer = await withTenant(tenant.id, async (tx) => {
    const existingUser = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE tenant_id = ${tenant.id}::uuid AND lower(email) = ${normalized} LIMIT 1
    `;

    let userId: string;
    if (existingUser.length) {
      userId = existingUser[0].id;
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, passwordAlgo: "argon2id", emailVerifiedAt: new Date() },
      });
    } else {
      const user = await tx.user.create({
        data: { tenantId: tenant.id, kind: "customer", email: normalized, passwordHash, passwordAlgo: "argon2id", emailVerifiedAt: new Date() },
      });
      userId = user.id;
    }

    const existingCustomer = await tx.customer.findUnique({ where: { userId } });
    if (existingCustomer) {
      return tx.customer.update({
        where: { userId },
        data: { firstName: input.firstName, lastName: input.lastName, mobileNumber: input.phone },
      });
    }
    return tx.customer.create({
      data: { tenantId: tenant.id, userId, firstName: input.firstName, lastName: input.lastName, mobileNumber: input.phone },
    });
  });

  await issueSession(tenant.id, customer.userId, "customer", CUSTOMER_SESSION_HOURS);
  return { email: normalized, expiresInHours: CUSTOMER_SESSION_HOURS };
}

export async function loginCustomer(email: string, password: string) {
  const tenant = await resolveTenant();
  const normalized = normalizeEmail(email);

  const rows = await withTenant(tenant.id, (tx) =>
    tx.$queryRaw<{ id: string; password_hash: string | null }[]>`
      SELECT id, password_hash FROM users
      WHERE tenant_id = ${tenant.id}::uuid AND kind = 'customer' AND lower(email) = ${normalized} LIMIT 1
    `
  );
  if (!rows.length || !rows[0].password_hash) {
    throw new Error("No registered account was found for this email. Start a booking to register.");
  }
  const valid = await verifyPassword(rows[0].password_hash, password);
  if (!valid) throw new Error("Incorrect email or password.");

  await issueSession(tenant.id, rows[0].id, "customer", CUSTOMER_SESSION_HOURS);
  return { email: normalized, expiresInHours: CUSTOMER_SESSION_HOURS };
}

export async function requestPasswordReset(email: string) {
  const tenant = await resolveTenant();
  const normalized = normalizeEmail(email);
  const rows = await withTenant(tenant.id, (tx) =>
    tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE tenant_id = ${tenant.id}::uuid AND kind = 'customer' AND lower(email) = ${normalized} AND password_hash IS NOT NULL LIMIT 1
    `
  );
  if (!rows.length) throw new Error("No registered account was found for this email.");
  const result = await sendOtpChallenge(tenant.id, normalized, "reset");
  return await deliverOtp(tenant.id, normalized, "reset", result);
}

export async function resetCustomerPassword(email: string, code: string, password: string) {
  const tenant = await resolveTenant();
  const normalized = normalizeEmail(email);
  validatePassword(password);
  await verifyOtpChallenge(tenant.id, normalized, "reset", code);

  const passwordHash = await hashPassword(password);
  const rows = await withTenant(tenant.id, async (tx) => {
    const existing = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE tenant_id = ${tenant.id}::uuid AND kind = 'customer' AND lower(email) = ${normalized} LIMIT 1
    `;
    if (!existing.length) throw new Error("No registered account was found for this email.");
    await tx.user.update({ where: { id: existing[0].id }, data: { passwordHash, passwordAlgo: "argon2id", emailVerifiedAt: new Date() } });
    return existing;
  });

  await issueSession(tenant.id, rows[0].id, "customer", CUSTOMER_SESSION_HOURS);
  return { email: normalized, expiresInHours: CUSTOMER_SESSION_HOURS };
}

export async function logoutCustomer() {
  const tenant = await resolveTenant();
  await clearSession(tenant.id, "customer");
}

/** The signed-in customer's identity for this request, or null. Used by the
 * booking transaction (create.ts) instead of trusting a raw email field. */
export async function getCurrentCustomer() {
  const tenant = await resolveTenant();
  const session = await verifySession(tenant.id, "customer");
  if (!session) return null;

  const customer = await withTenant(tenant.id, (tx) => tx.customer.findUnique({ where: { userId: session.userId } }));
  return customer;
}
