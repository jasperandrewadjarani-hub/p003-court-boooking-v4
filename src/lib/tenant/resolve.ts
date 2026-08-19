import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";

export class TenantNotFoundError extends Error {
  constructor(hostname: string) {
    super(`No tenant is bound to hostname "${hostname}"`);
    this.name = "TenantNotFoundError";
  }
}

/**
 * Resolves the current request's tenant from the hostname stamped by
 * src/proxy.ts. Deliberately NOT cached across requests — tenant_domains
 * changes (a new custom domain, a tenant suspension) must take effect
 * immediately, and this query is a single indexed lookup (master plan §4.3:
 * `tenant_domains (lower(hostname))` UNIQUE), not a full scan.
 *
 * This resolves identity only. It does not set RLS scope — every actual
 * data query still goes through withTenant(tenantId, ...) (§5.2), so a bug
 * here can misroute a request to the wrong tenant's public branding at
 * worst, never leak another tenant's data.
 */
export async function resolveTenant() {
  const headerList = await headers();
  const hostname = headerList.get("x-tenant-hostname") ?? "";
  // Strip a port suffix (e.g. "dink-and-dunk.localhost:3000") for local dev;
  // production hostnames never carry one.
  const hostOnly = hostname.split(":")[0];

  // Select every tenant scalar EXCEPT logoUrl — resolveTenant runs on every
  // request/server-action (incl. the 20s grid/bookings polls), and the logo is
  // a ~500 KB inline data-URI. Pulling it here shipped it on every one of those.
  // The two places that actually render the logo (customer header, admin shell)
  // read it from branding settings, which they already fetch for CSS.
  const tenantSelect = {
    id: true, slug: true, name: true, status: true, timezone: true, currency: true,
    locale: true, primaryColor: true, accentColor: true, senderName: true,
    senderEmail: true, featureFlags: true, createdAt: true, updatedAt: true,
  } as const;

  const domain = await prisma.tenantDomain.findFirst({
    where: { hostname: { equals: hostname === hostOnly ? hostname : hostname, mode: "insensitive" } },
    select: { tenant: { select: tenantSelect } },
  });

  // Fall back to a port-stripped match so "dink-and-dunk.localhost:3000" and
  // a seeded "dink-and-dunk.localhost" domain both resolve in local dev,
  // without weakening the production lookup (which never has a port).
  const resolved =
    domain ??
    (await prisma.tenantDomain.findFirst({
      where: { hostname: { equals: hostOnly, mode: "insensitive" } },
      select: { tenant: { select: tenantSelect } },
    }));

  if (!resolved || resolved.tenant.status !== "active") {
    throw new TenantNotFoundError(hostname);
  }

  return resolved.tenant;
}
