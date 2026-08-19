"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/courts", label: "Courts" },
  { href: "/admin/pricing", label: "Price Matrix" },
  { href: "/admin/memberships", label: "Memberships and Discounts" },
  { href: "/admin/holidays", label: "Holidays" },
  { href: "/admin/staff", label: "Staff Accounts" },
  { href: "/admin/settings", label: "Settings" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <div className="admin-nav-tabs">
      {NAV_ITEMS.map((item) => (
        <Link key={item.href} href={item.href} className={`admin-nav-item ${pathname === item.href ? "active" : ""}`}>
          {item.label}
        </Link>
      ))}
    </div>
  );
}
