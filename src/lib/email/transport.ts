import "server-only";

/**
 * EMAIL_TRANSPORT selects how mail actually leaves the app:
 *   "smtp"   — Gmail SMTP (src/lib/email/smtp.ts). The closest match to v3b's
 *              Google MailApp: sends from the same Gmail account. Needs
 *              SMTP_USER + SMTP_PASS (a Google App Password).
 *   "resend" — Resend HTTP API (src/lib/email/resend.ts). Needs a DNS-verified
 *              sending domain instead of a Gmail App Password.
 *   unset / "console" — the $0 dev-mode fallback: OTP codes are surfaced
 *              directly in the server action's response behind an unmistakable
 *              "DEV MODE" banner instead of actually emailed.
 *
 * NOTE — deliberately NOT gated on NODE_ENV. Vercel sets NODE_ENV=production
 * for every deployment, including this project's current single-facility
 * $0 test phase (see notes.md 2026-08-12) — there is no separate "real
 * production" environment yet to distinguish it from. Once a Resend account
 * + verified domain exist, flipping to real delivery is switching this one
 * env var to "resend", a deliberate operational step (Phase F), not
 * something a code-level throw needs to force early.
 */
export type EmailTransportMode = "console" | "resend" | "smtp";

export function getEmailTransportMode(): EmailTransportMode {
  return (process.env.EMAIL_TRANSPORT ?? "console") as EmailTransportMode;
}
