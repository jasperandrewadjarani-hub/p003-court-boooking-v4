import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getEmailTransportMode } from "@/lib/email/transport";
import { sendViaResend, type OutgoingEmail } from "@/lib/email/resend";
import { sendViaSmtp } from "@/lib/email/smtp";

type JsonPayload = Record<string, string | number | boolean | null | undefined>;

/**
 * Routes a rendered email to whichever real transport is active. `console`
 * (dev-mode) never reaches here — those codes are surfaced on-screen by the
 * caller instead. One dispatch point so every template (OTP today, booking/
 * payment notifications next) sends the same way v3b's single MailApp call did.
 */
export async function dispatchEmail(email: OutgoingEmail): Promise<void> {
  const mode = getEmailTransportMode();
  if (mode === "smtp") return sendViaSmtp(email);
  if (mode === "resend") return sendViaResend(email);
  throw new Error(`dispatchEmail called in "${mode}" mode — only smtp/resend actually send email.`);
}

/**
 * Every outbound email goes through this one function regardless of
 * transport — mirrors v2's queue-then-send pattern, and means switching
 * from dev-mode console output to real Resend delivery later (Phase F) is
 * a one-file change (src/lib/email/resend.ts), not a rearchitecture.
 */
export async function enqueueEmail(
  tx: Prisma.TransactionClient,
  tenantId: string,
  template: string,
  to: string,
  payload: JsonPayload
): Promise<void> {
  await tx.emailOutbox.create({
    data: { tenantId, template, toAddresses: [to], payload: payload as Prisma.InputJsonValue },
  });
}
