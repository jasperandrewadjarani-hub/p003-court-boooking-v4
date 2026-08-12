import type { Prisma } from "@/generated/prisma/client";
import type { BookingRulesSettings } from "@/lib/booking/availability";

/**
 * Lazy read-repair for stale unpaid reservations — v2 ran this as a 10-min
 * cron (expireStalePendingBookings); Vercel Hobby's cron is daily-only, so
 * instead this runs inline at the top of every transaction that reads
 * bookings (grid, create, My Bookings, admin list), before that read, so a
 * slot someone abandoned reappears the moment anyone next looks rather than
 * waiting on a clock. A once-daily cron (Phase F) is a backstop only, for
 * the edge case of a date nobody reads again.
 *
 * Only unpaid/awaiting_verification reservations ever lapse this way —
 * anything with a payment recorded (partial/paid) is excluded by the WHERE
 * clause itself, matching v2's "already paid something, never auto-expire"
 * rule exactly.
 */
export async function sweepLapsedBookings(
  tx: Prisma.TransactionClient,
  tenantId: string,
  rules: Pick<BookingRulesSettings, "reservationHoldMinutes" | "receiptReviewHoldMinutes">
): Promise<string[]> {
  const lapsedGroups = await tx.$queryRaw<{ id: string }[]>`
    UPDATE booking_groups SET status = 'lapsed', updated_at = now()
    WHERE tenant_id = ${tenantId}::uuid AND status = 'reserved'
      AND (
        (payment_status = 'unpaid' AND created_at < now() - (${rules.reservationHoldMinutes} || ' minutes')::interval)
        OR (payment_status = 'awaiting_verification' AND created_at < now() - (${rules.receiptReviewHoldMinutes} || ' minutes')::interval)
      )
    RETURNING id
  `;

  if (lapsedGroups.length) {
    const ids = lapsedGroups.map((g) => g.id);
    await tx.$executeRaw`
      UPDATE bookings SET status = 'lapsed', updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND booking_group_id = ANY(${ids}::uuid[])
    `;
  }

  return lapsedGroups.map((g) => g.id);
}
