import type { Metadata } from "next";
import { Rajdhani, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { resolveTenant } from "@/lib/tenant/resolve";
import "./globals.css";

// Ported from v2's CSS.html font stack (Rajdhani / IBM Plex Sans / IBM Plex
// Mono) via next/font/google instead of the old @import url() — self-hosted
// at build time, no runtime request to Google Fonts, no layout shift.
const rajdhani = Rajdhani({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// Tab title follows the resolved tenant (per hostname), so each facility's URL
// shows its own business name instead of a generic app name. Falls back to a
// neutral title for an unrecognised host (resolveTenant throws there).
export async function generateMetadata(): Promise<Metadata> {
  try {
    const tenant = await resolveTenant();
    return {
      title: tenant.name,
      description: `Online court booking for ${tenant.name}.`,
    };
  } catch {
    return {
      title: "Court Booking",
      description: "Multi-tenant court booking platform.",
    };
  }
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // v2 defaults to dark; light is opt-in via [data-theme="light"]
      // (tokens.css). No toggle UI yet — that's UX-phase work, not Phase 0.
      className={`${rajdhani.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
