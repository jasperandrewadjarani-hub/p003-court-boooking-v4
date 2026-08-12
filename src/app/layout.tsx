import type { Metadata } from "next";
import { Rajdhani, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "P003 Court Booking Platform",
  description: "v4 — Next.js + Postgres multi-tenant court booking platform (Phase 0)",
};

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
