import { headers } from "next/headers";
import { resolveTenant, TenantNotFoundError } from "@/lib/tenant/resolve";
import { getAvailabilityGrid, getBookingRules } from "@/lib/booking/availability";
import { getActiveMemberships } from "@/lib/booking/memberships";
import { getPaymentSettings } from "@/lib/booking/paymentSettings";
import { getBrandingSettings, brandingToCss } from "@/lib/admin/settings";
import { listDiscounts } from "@/lib/admin/masterData";
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
    const [grid, memberships, paymentSettings, rules, branding, discounts] = await Promise.all([
      getAvailabilityGrid(tenant.id, dateKey),
      getActiveMemberships(tenant.id),
      getPaymentSettings(tenant.id),
      getBookingRules(tenant.id),
      getBrandingSettings(tenant.id),
      listDiscounts(tenant.id),
    ]);
    const hasActiveDiscount = discounts.some((d) => d.active);

    return (
      <>
        {branding.headingFontUrl && <link rel="stylesheet" href={branding.headingFontUrl} />}
        <style dangerouslySetInnerHTML={{ __html: brandingToCss(branding) }} />
      <BookingPage
        tenant={{
          name: tenant.name,
          slug: tenant.slug,
          currency: tenant.currency,
          logoUrl: branding.logoUrl, // from branding settings — resolveTenant no longer ships the logo
          headerLogoUrl: branding.headerLogoUrl, // full text/banner logo — replaces logo + title when set
        }}
        initialGrid={grid}
        memberships={memberships}
        paymentSettings={paymentSettings}
        reservationHoldMinutes={rules.reservationHoldMinutes}
        maxCourtHoursPerBooking={rules.maxCourtHoursPerBooking}
        maxAdvanceBookingDays={rules.maxAdvanceBookingDays}
        hasActiveDiscount={hasActiveDiscount}
      />
      </>
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
