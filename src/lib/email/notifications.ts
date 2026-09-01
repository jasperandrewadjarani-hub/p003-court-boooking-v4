import "server-only";
import { withTenant } from "@/lib/tenant/withTenant";
import { getNotificationSettings } from "@/lib/admin/settings";
import { getEmailTransportMode } from "@/lib/email/transport";
import { enqueueEmail, dispatchEmail } from "@/lib/email/send";
import { renderTemplate } from "@/lib/email/resend";

/**
 * Emails the facility's staff recipients when a customer submits a payment
 * (uploads a receipt → the booking becomes Awaiting Verification and needs
 * confirmation). Gated by the "Admin Receipt Alert" notification toggle + the
 * recipient list (Settings → Reports & Notifications). Best-effort: never
 * throws into the caller — a failed notification must not fail the customer's
 * receipt upload. No email in `console` (dev) transport.
 *
 * Deliberately NOT sent for reserved/unpaid bookings — only actual payment
 * submissions, per the client's request.
 */
export async function notifyPaymentSubmitted(tenantId: string, bookingGroupId: string): Promise<void> {
  try {
    if (getEmailTransportMode() === "console") return;
    const notif = await getNotificationSettings(tenantId);
    if (!notif.adminReceiptAlert) return;
    const recipients = (notif.adminEmails || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!recipients.length) return;

    const group = await withTenant(tenantId, (tx) =>
      tx.bookingGroup.findUnique({
        where: { id: bookingGroupId },
        include: { customer: true, bookings: { include: { court: { omit: { imageUrl: true } } }, orderBy: { startsAt: "asc" } } },
      })
    );
    if (!group) return;

    const payload = {
      subject: `Payment submitted — ${group.reference ?? "booking"}`,
      customerName: `${group.customer.firstName} ${group.customer.lastName}`.trim() || "(customer)",
      reference: group.reference ?? "—",
      playDate: group.bookings[0]?.localDate?.toISOString().slice(0, 10) ?? "—",
      total: (group.totalMinor / 100).toFixed(2),
    };
    const { subject, html } = renderTemplate("admin_payment_alert", payload);

    const bcc = (notif.notificationBcc || "").trim();
    const targets = bcc ? [...recipients, bcc] : recipients;
    for (const to of targets) {
      await withTenant(tenantId, (tx) => enqueueEmail(tx, tenantId, "admin_payment_alert", to, payload));
      try {
        await dispatchEmail({ to, subject, html });
        await withTenant(tenantId, (tx) =>
          tx.emailOutbox.updateMany({
            where: { tenantId, template: "admin_payment_alert", toAddresses: { has: to }, status: "queued" },
            data: { status: "sent", sentAt: new Date() },
          })
        );
      } catch {
        // leave the row queued; a future drain/backstop can retry.
      }
    }
  } catch {
    // notification is best-effort — swallow everything.
  }
}
