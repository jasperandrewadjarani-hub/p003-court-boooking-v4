"use client";

import { useEffect, useState } from "react";

/** Admin light/dark toggle — mirrors the customer one, sharing the same
 * localStorage key + [data-theme] mechanism so a tenant's branding light/dark
 * palettes apply across both shells. */
export function AdminThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const saved = (localStorage.getItem("volt_theme") as "dark" | "light" | null) ?? "dark";
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
  }, []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("volt_theme", next);
  }
  return (
    <button className="theme-toggle" onClick={toggle}>
      {theme === "dark" ? "☾ Light Mode" : "☀ Dark Mode"}
    </button>
  );
}
