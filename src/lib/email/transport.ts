import "server-only";

/**
 * EMAIL_TRANSPORT=resend is the real path (Phase F wires src/lib/email/
 * resend.ts once a Resend account + verified sending domain exist).
 * EMAIL_TRANSPORT unset/"console" is the $0 dev-mode fallback: OTP codes
 * are surfaced directly in the server action's response behind an
 * unmistakable "DEV MODE" banner instead of actually emailed.
 *
 * NOTE — deliberately NOT gated on NODE_ENV. Vercel sets NODE_ENV=production
 * for every deployment, including this project's current single-facility
 * $0 test phase (see notes.md 2026-08-12) — there is no separate "real
 * production" environment yet to distinguish it from. Once a Resend account
 * + verified domain exist, flipping to real delivery is switching this one
 * env var to "resend", a deliberate operational step (Phase F), not
 * something a code-level throw needs to force early.
 */
export type EmailTransportMode = "console" | "resend";

export function getEmailTransportMode(): EmailTransportMode {
  return (process.env.EMAIL_TRANSPORT ?? "console") as EmailTransportMode;
}
