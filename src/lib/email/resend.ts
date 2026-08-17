import "server-only";

/**
 * Real email delivery via the Resend HTTP API (no SDK dependency — a single
 * fetch to the documented endpoint). This is v3b's MailApp equivalent for the
 * Vercel/Postgres architecture: v3b sent mail from the deploying Google
 * account, which a serverless function can't do, so a transactional-email
 * provider is the unavoidable substitute.
 *
 * Activation is purely operational — set three env vars, no code change:
 *   EMAIL_TRANSPORT=resend
 *   RESEND_API_KEY=re_...            (from resend.com)
 *   RESEND_FROM="Volt Courts <no-reply@yourdomain.com>"   (a DNS-verified domain)
 *
 * Until those exist the app stays in the $0 console/dev-mode transport (OTP
 * shown on-screen). This function fails loudly if called without them rather
 * than silently pretending mail went out.
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  bcc?: string[];
}

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

export async function sendViaResend(email: OutgoingEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    throw new Error("Resend is not configured — set RESEND_API_KEY and RESEND_FROM (a DNS-verified sending domain).");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email.to],
      subject: email.subject,
      html: email.html,
      ...(email.bcc && email.bcc.length ? { bcc: email.bcc } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend delivery failed (${res.status}): ${detail.slice(0, 300)}`);
  }
}

/** Minimal branded HTML wrapper shared by all templates — keeps delivery
 *  looking intentional without pulling in a templating dependency. */
function shell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#060A10;font-family:Segoe UI,Arial,sans-serif;color:#E7F6F2;padding:24px">
    <div style="max-width:480px;margin:0 auto;background:#0D1520;border:1px solid #1C2733;border-radius:12px;padding:28px">
      <h1 style="margin:0 0 16px;font-size:18px;color:#C6FF3D">${title}</h1>
      ${bodyHtml}
      <p style="margin:24px 0 0;font-size:11px;color:#7C93A3">Volt Courts · automated message, please do not reply.</p>
    </div></body></html>`;
}

/** Renders an enqueued EmailOutbox row into a subject + HTML body. Mirrors the
 *  set of templates v3b sends; unknown templates fall back to a generic body so
 *  the drain never throws on an unrecognised type. */
export function renderTemplate(template: string, payload: Record<string, unknown>): { subject: string; html: string } {
  const p = payload as Record<string, string>;
  switch (true) {
    case template.startsWith("otp_"): {
      const subject = p.subject || "Your verification code";
      return {
        subject,
        html: shell(subject, `<p style="margin:0 0 12px">Your verification code is:</p>
          <p style="font-size:30px;letter-spacing:4px;font-weight:700;color:#2EE6FF;margin:0 0 12px">${p.code ?? ""}</p>
          <p style="margin:0;font-size:12px;color:#7C93A3">This code expires shortly. If you didn't request it, ignore this email.</p>`),
      };
    }
    case template === "booking_confirmation": {
      const subject = "Your booking is confirmed";
      return { subject, html: shell(subject, `<p>${p.body ?? "Your court booking has been confirmed."}</p>`) };
    }
    case template === "payment_confirmation": {
      const subject = "Payment received";
      return { subject, html: shell(subject, `<p>${p.body ?? "We've recorded your payment. Thank you!"}</p>`) };
    }
    default: {
      const subject = p.subject || "Notification";
      return { subject, html: shell(subject, `<p>${p.body ?? ""}</p>`) };
    }
  }
}
