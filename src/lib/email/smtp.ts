import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import type { OutgoingEmail } from "@/lib/email/resend";

/**
 * Gmail SMTP transport — the closest possible match to v3b's Google MailApp:
 * v3b sends mail from the deploying Google account's Gmail, and this sends from
 * that same Gmail account over SMTP. Same sender identity, same inbox behaviour;
 * only the wire protocol differs (SMTP vs the GAS-runtime MailApp API, which
 * simply does not exist off Apps Script).
 *
 * Activation is purely operational — no code change, just env vars in Vercel:
 *   EMAIL_TRANSPORT=smtp
 *   SMTP_USER=your.account@gmail.com
 *   SMTP_PASS=<16-char Google App Password>   (NOT your normal password —
 *             myaccount.google.com → Security → 2-Step Verification → App passwords)
 *   SMTP_FROM="Volt Courts <your.account@gmail.com>"   (optional; defaults to SMTP_USER)
 *
 * Runs on the Node runtime only (server actions / route handlers), never Edge.
 */

let cached: Transporter | null = null;

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter(): Transporter {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    throw new Error("Gmail SMTP is not configured — set SMTP_USER and SMTP_PASS (a Google App Password).");
  }
  if (!cached) {
    cached = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 465),
      secure: (process.env.SMTP_PORT || "465") === "465", // 465 = implicit TLS
      auth: { user, pass },
    });
  }
  return cached;
}

export async function sendViaSmtp(email: OutgoingEmail): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  await getTransporter().sendMail({
    from,
    to: email.to,
    subject: email.subject,
    html: email.html,
    ...(email.bcc && email.bcc.length ? { bcc: email.bcc } : {}),
  });
}
