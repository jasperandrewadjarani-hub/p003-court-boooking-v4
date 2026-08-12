import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import { withTenant } from "@/lib/tenant/withTenant";
import type { UserKind } from "@/generated/prisma/client";

// Two separate cookie namespaces — a customer_session token can NEVER be
// presented as a staff_session token, structurally, not by a kind check
// that's easy to forget (matches v2's Auth.js comment: "a customer session
// token can never be reused to call admin functions").
const COOKIE_NAMES: Record<UserKind, string> = {
  customer: "customer_session",
  staff: "staff_session",
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionInfo {
  userId: string;
  tenantId: string;
  kind: UserKind;
}

/** Issues a new session, sets the httpOnly cookie. Call from a Server Action only. */
export async function issueSession(tenantId: string, userId: string, kind: UserKind, hours: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + hours * 3600_000);

  await withTenant(tenantId, (tx) =>
    tx.session.create({ data: { tenantId, userId, kind, tokenHash, expiresAt } })
  );

  const jar = await cookies();
  jar.set(COOKIE_NAMES[kind], token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // No `domain` set — host-only, matching master plan §5.3: a session on
    // one tenant's hostname must never be presented on another's.
    maxAge: hours * 3600,
  });
}

/** Reads and verifies the current request's session cookie for the given kind. */
export async function verifySession(tenantId: string, kind: UserKind): Promise<SessionInfo | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAMES[kind])?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await withTenant(tenantId, (tx) =>
    tx.session.findUnique({ where: { tenantId_tokenHash: { tenantId, tokenHash } } })
  );
  if (!session || session.kind !== kind || session.expiresAt < new Date()) return null;

  return { userId: session.userId, tenantId, kind };
}

/** Clears the session cookie and invalidates it server-side. Call from a Server Action only. */
export async function clearSession(tenantId: string, kind: UserKind): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAMES[kind])?.value;
  jar.delete(COOKIE_NAMES[kind]);
  if (!token) return;
  const tokenHash = hashToken(token);
  await withTenant(tenantId, (tx) => tx.session.deleteMany({ where: { tenantId, tokenHash } }));
}
