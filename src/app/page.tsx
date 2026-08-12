import { headers } from "next/headers";
import { resolveTenant, TenantNotFoundError } from "@/lib/tenant/resolve";
import { getAvailabilityGrid } from "@/lib/booking/availability";
import { BookingPage } from "@/components/booking/BookingPage";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function Home() {
  const headerList = await headers();
  const hostname = headerList.get("x-tenant-hostname") ?? "(unknown host)";

  try {
    const tenant = await resolveTenant();
    const dateKey = todayKey();
    const grid = await getAvailabilityGrid(tenant.id, dateKey);

    return (
      <BookingPage
        tenant={{
          name: tenant.name,
          slug: tenant.slug,
          currency: tenant.currency,
          primaryColor: tenant.primaryColor ?? "#C6FF3D",
          accentColor: tenant.accentColor ?? "#2EE6FF",
        }}
        initialGrid={grid}
      />
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
