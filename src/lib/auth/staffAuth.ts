"use server";

import { withTenant } from "@/lib/tenant/withTenant";
import { resolveTenant } from "@/lib/tenant/resolve";
import { verifyPassword } from "@/lib/auth/password";
import { issueSession, verifySession, clearSession } from "@/lib/auth/session";

const STAFF_SESSION_HOURS = 6; // matches v2's 6-hour frontdesk shift

/** Staff login — password only, no OTP branch (v2's admin login is
 * password-only against Staff/User, unlike the customer OTP flow). */
export async function loginStaff(email: string, password: string) {
  const tenant = await resolveTenant();
  const normalized = email.trim().toLowerCase();

  const rows = await withTenant(tenant.id, (tx) =>
    tx.$queryRaw<{ id: string; password_hash: string | null }[]>`
      SELECT id, password_hash FROM users
      WHERE tenant_id = ${tenant.id}::uuid AND kind = 'staff' AND lower(email) = ${normalized} LIMIT 1
    `
  );
  if (!rows.length || !rows[0].password_hash) {
    throw new Error("Incorrect email or password.");
  }
  const valid = await verifyPassword(rows[0].password_hash, password);
  if (!valid) throw new Error("Incorrect email or password.");

  const staff = await withTenant(tenant.id, (tx) => tx.staff.findUnique({ where: { userId: rows[0].id } }));
  if (!staff || !staff.active) throw new Error("This staff account is inactive.");

  await issueSession(tenant.id, rows[0].id, "staff", STAFF_SESSION_HOURS);
  return { email: normalized, name: staff.name, role: staff.role };
}

export async function logoutStaff() {
  const tenant = await resolveTenant();
  await clearSession(tenant.id, "staff");
}

/** The signed-in staff member's identity for this request, or null. */
export async function getCurrentStaff() {
  const tenant = await resolveTenant();
  const session = await verifySession(tenant.id, "staff");
  if (!session) return null;

  const staff = await withTenant(tenant.id, (tx) => tx.staff.findUnique({ where: { userId: session.userId } }));
  if (!staff || !staff.active) return null;
  return staff;
}

/** Throws if not signed in — call at the top of every admin server action/page. */
export async function requireStaff() {
  const staff = await getCurrentStaff();
  if (!staff) throw new Error("Admin session expired. Please log in again.");
  return staff;
}
