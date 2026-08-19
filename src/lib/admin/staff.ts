import "server-only";
import { withTenant } from "@/lib/tenant/withTenant";
import { hashPassword, validatePassword } from "@/lib/auth/password";
import { sendOtpChallenge, verifyOtpChallenge, normalizeEmail } from "@/lib/auth/otp";
import { verifySuperAdminPassword } from "@/lib/admin/settings";
import { enqueueEmail, dispatchEmail } from "@/lib/email/send";
import { getEmailTransportMode } from "@/lib/email/transport";
import { renderTemplate } from "@/lib/email/resend";
import type { StaffRole } from "@/generated/prisma/client";

export async function listStaffAdmin(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx.staff.findMany({
      where: { tenantId },
      include: { user: { select: { email: true } } },
      orderBy: { name: "asc" },
    })
  );
}

export interface BeginAddStaffResult {
  email: string;
  devMode: boolean;
  devCode?: string;
  expiresAt: Date;
}

/** Step 1 of adding a staff account: verify the super-admin password gate and
 *  that this email isn't already staff, then send an OTP to the new address. */
export async function beginAddStaff(tenantId: string, superAdminPassword: string, email: string): Promise<BeginAddStaffResult> {
  const normalized = normalizeEmail(email);

  const okPassword = await verifySuperAdminPassword(tenantId, superAdminPassword);
  if (!okPassword) throw new Error("Incorrect super-admin password.");

  const existing = await withTenant(tenantId, (tx) =>
    tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE tenant_id = ${tenantId}::uuid AND kind = 'staff' AND lower(email) = ${normalized} LIMIT 1
    `
  );
  if (existing.length) throw new Error("A staff account with this email already exists.");

  const result = await sendOtpChallenge(tenantId, normalized, "add_staff");
  const subject = "Verify new staff account";

  if (!result.alreadySent && result.code) {
    await withTenant(tenantId, (tx) => enqueueEmail(tx, tenantId, "otp_add_staff", normalized, { code: result.code, subject }));
  }

  const transport = getEmailTransportMode();
  if (transport === "console") {
    console.log(`[DEV EMAIL] ${subject} for ${normalized}: ${result.code ?? "(already sent, unchanged)"}`);
    return { email: normalized, devMode: true, devCode: result.code, expiresAt: result.expiresAt };
  }

  if (!result.alreadySent && result.code) {
    const { subject: subj, html } = renderTemplate("otp_add_staff", { code: result.code, subject });
    await dispatchEmail({ to: normalized, subject: subj, html });
    await withTenant(tenantId, (tx) =>
      tx.emailOutbox.updateMany({
        where: { tenantId, template: "otp_add_staff", toAddresses: { has: normalized }, status: "queued" },
        data: { status: "sent", sentAt: new Date() },
      })
    );
  }
  return { email: normalized, devMode: false, expiresAt: result.expiresAt };
}

export interface CompleteAddStaffInput {
  email: string;
  code: string;
  password: string;
  name: string;
  position?: string;
  role: StaffRole;
}

/** Step 2: verify the OTP, then create the User(kind=staff) + Staff rows. */
export async function completeAddStaff(tenantId: string, input: CompleteAddStaffInput) {
  const normalized = normalizeEmail(input.email);
  validatePassword(input.password);
  await verifyOtpChallenge(tenantId, normalized, "add_staff", input.code);

  const passwordHash = await hashPassword(input.password);
  return withTenant(tenantId, async (tx) => {
    const user = await tx.user.create({
      data: { tenantId, kind: "staff", email: normalized, passwordHash, passwordAlgo: "argon2id", emailVerifiedAt: new Date() },
    });
    return tx.staff.create({
      data: { tenantId, userId: user.id, name: input.name, position: input.position || null, role: input.role, active: true },
    });
  });
}

export async function setStaffActive(tenantId: string, staffId: string, active: boolean) {
  return withTenant(tenantId, (tx) => tx.staff.update({ where: { id: staffId }, data: { active } }));
}

export async function setStaffRole(tenantId: string, staffId: string, role: StaffRole) {
  return withTenant(tenantId, (tx) => tx.staff.update({ where: { id: staffId }, data: { role } }));
}
