import { redirect } from "next/navigation";
import { getCurrentStaff, logoutStaff } from "@/lib/auth/staffAuth";
import { resolveTenant } from "@/lib/tenant/resolve";
import { getBrandingSettings, brandingToCss } from "@/lib/admin/settings";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminThemeToggle } from "@/components/admin/AdminThemeToggle";
import { LogoutButton } from "@/components/admin/LogoutButton";

export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");

  const tenant = await resolveTenant();
  const branding = await getBrandingSettings(tenant.id);

  async function doLogout() {
    "use server";
    await logoutStaff();
    redirect("/admin/login");
  }

  return (
    <div className="admin-shell">
      {branding.headingFontUrl && <link rel="stylesheet" href={branding.headingFontUrl} />}
      <style dangerouslySetInnerHTML={{ __html: brandingToCss(branding) }} />
      <AdminThemeToggle />
      <div className="admin-sidebar">
        {branding.logoUrl && (
          // From branding settings (already fetched for CSS) — resolveTenant no longer ships the logo.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={branding.logoUrl} alt={tenant.name} className="admin-brand-logo" />
        )}
        <div className="brand" style={{ fontSize: 20 }}>
          {tenant.name.toUpperCase()}
        </div>
        <AdminNav />
        <div className="admin-nav-item admin-nav-logout">
          <LogoutButton onLogout={doLogout} />
        </div>
        <div className="admin-nav-item dim admin-nav-account">{staff.name}</div>
        <div className="admin-nav-item dim admin-nav-credit">
          <a href="https://www.facebook.com/profile.php?id=61590234100280" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
            Powered by JT Consulting &amp; Analytics
          </a>
        </div>
      </div>
      <div className="admin-main">{children}</div>
    </div>
  );
}
