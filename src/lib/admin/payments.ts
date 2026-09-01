import "server-only";
import { randomBytes } from "crypto";
import type { Prisma } from "@/generated/prisma/client";
import { createNotification } from "@/lib/notifications/store";

/**
 * Records a payment and recomputes BookingGroup.amountPaidMinor from the
 * Payment ledger — never written directly, per the schema's own comment.
 * Full payment auto-promotes reserved -> confirmed, matching v2's
 * "confirming a payment in full also confirms the booking" behavior;
 * partial payment never regresses an already-confirmed/further-along
 * status backward.
 */
export async function recordPayment(
  tx: Prisma.TransactionClient,
  args: { tenantId: string; bookingGroupId: string; method: "cash" | "gcash" | "maya" | "credit_card" | "bank_transfer" | "gotyme"; amountMinor: number; staffUserId: string }
) {
  const group = await tx.bookingGroup.findUnique({ where: { id: args.bookingGroupId } });
  if (!group) throw new Error("Booking not found.");
  if (args.amountMinor <= 0) throw new Error("Enter a valid payment amount.");

  // Reject overpayment above the remaining balance — v3b's recordPayment_
  // rejects amounts exceeding the calculated remaining balance (CURRENT_STATE
  // §4.2 "overpayment above the calculated remaining balance is rejected").
  const alreadyPaid = await tx.payment.aggregate({ where: { tenantId: args.tenantId, bookingGroupId: args.bookingGroupId }, _sum: { amountMinor: true } });
  const remainingMinor = group.totalMinor - (alreadyPaid._sum.amountMinor ?? 0);
  if (args.amountMinor > remainingMinor) {
    throw new Error(`Payment exceeds the remaining balance of ${(remainingMinor / 100).toFixed(2)}.`);
  }

  const receiptNumber = `PMT-${Date.now()}-${randomBytes(3).toString("hex").toUpperCase()}`;

  await tx.payment.create({
    data: {
      tenantId: args.tenantId,
      bookingGroupId: args.bookingGroupId,
      method: args.method,
      amountMinor: args.amountMinor,
      totalMinor: args.amountMinor,
      receiptNumber,
      staffUserId: args.staffUserId,
    },
  });

  const paid = await tx.payment.aggregate({ where: { tenantId: args.tenantId, bookingGroupId: args.bookingGroupId }, _sum: { amountMinor: true } });
  const amountPaidMinor = paid._sum.amountMinor ?? 0;

  const isFullyPaid = amountPaidMinor >= group.totalMinor;
  const newPaymentStatus = isFullyPaid ? "paid" : amountPaidMinor > 0 ? "partial" : group.paymentStatus;
  const newStatus = isFullyPaid && group.status === "reserved" ? "confirmed" : group.status;

  await tx.bookingGroup.update({
    where: { id: args.bookingGroupId },
    data: { amountPaidMinor, paymentStatus: newPaymentStatus, status: newStatus },
  });

  // Full payment just confirmed the booking → notify the customer.
  if (newStatus === "confirmed" && group.status !== "confirmed") {
    await createNotification(tx, args.tenantId, { audience: "customer", customerId: group.customerId, type: "booking_confirmed", bookingGroupId: args.bookingGroupId, title: "Booking confirmed", body: `Your payment for ${group.reference ?? "your booking"} is verified — booking confirmed!` });
  }

  await tx.auditLog.create({
    data: {
      tenantId: args.tenantId,
      actorUserId: args.staffUserId,
      actorKind: "staff",
      entity: "booking_group",
      entityId: args.bookingGroupId,
      action: "RECORD_PAYMENT",
      details: { amountMinor: args.amountMinor, method: args.method, receiptNumber },
    },
  });

  return { amountPaidMinor, paymentStatus: newPaymentStatus, status: newStatus };
}
