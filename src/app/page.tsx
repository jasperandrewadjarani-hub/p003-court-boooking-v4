import { headers } from "next/headers";
import { resolveTenant, TenantNotFoundError } from "@/lib/tenant/resolve";

// Phase 0 proof-of-concept page: resolves the tenant from the request
// hostname and renders its branding. This is deliberately NOT the booking
// UI (that's master plan Phase 2) — it exists to prove the full chain
// (proxy -> header -> indexed DB lookup -> tenant-scoped render) works
// end to end before any booking logic is built on top of it.
export default async function Home() {
  const headerList = await headers();
  const hostname = headerList.get("x-tenant-hostname") ?? "(unknown host)";

  try {
    const tenant = await resolveTenant();
    return (
      <main
        className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center"
        style={{
          // CSS-variable theming (master plan §6.1) — this is the actual
          // white-label mechanism: same components, per-tenant values.
          ["--tenant-primary" as string]: tenant.primaryColor ?? "#000",
          ["--tenant-accent" as string]: tenant.accentColor ?? "#666",
        }}
      >
        <div
          className="rounded-full px-4 py-1 text-xs font-mono uppercase tracking-wide"
          style={{ background: "var(--tenant-accent)", color: "#060A10" }}
        >
          Tenant resolved
        </div>
        <h1 className="text-4xl font-bold" style={{ color: "var(--tenant-primary)" }}>
          {tenant.name}
        </h1>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-left font-mono opacity-70">
          <dt>slug</dt>
          <dd>{tenant.slug}</dd>
          <dt>hostname</dt>
          <dd>{hostname}</dd>
          <dt>timezone</dt>
          <dd>{tenant.timezone}</dd>
          <dt>currency</dt>
          <dd>{tenant.currency}</dd>
        </dl>
        <p className="max-w-md text-sm opacity-60">
          Phase 0 foundations: multi-tenant host resolution + database
          connectivity confirmed. Booking UI lands in Phase 2.
        </p>
      </main>
    );
  } catch (error) {
    if (error instanceof TenantNotFoundError) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
          <h1 className="text-2xl font-bold">No tenant bound to this hostname</h1>
          <p className="max-w-md font-mono text-sm opacity-70">{hostname}</p>
          <p className="max-w-md text-sm opacity-60">
            Try one of the seeded dev tenants:{" "}
            <code>dink-and-dunk.localhost:3000</code> or{" "}
            <code>demo-facility.localhost:3000</code>.
          </p>
        </main>
      );
    }
    throw error;
  }
}
