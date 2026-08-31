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
  // Staff/front-desk bookings never auto-lapse (v3b expireStalePendingBookings
  // explicitly excludes Booking Source === STAFF rows) — an admin holding a
  // walk-in reservation open isn't the same "abandoned checkout" case this
  // sweep exists to reclaim.
  const lapsedGroups = await tx.$queryRaw<{ id: string }[]>`
    UPDATE booking_groups SET status = 'lapsed', updated_at = now()
    WHERE tenant_id = ${tenantId}::uuid AND status = 'reserved' AND source != 'staff'
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
    // A lapsed reservation should NOT count against its discount code — release
    // the availment + budget back so an abandoned checkout doesn't burn a slot.
    // Set-based so several lapsed groups sharing one code net out correctly; the
    // just-lapsed groups keep their discountCode snapshot (for monitoring), only
    // the code's running counters are decremented. Runs once per group (a group
    // is only lapsed while status='reserved', then excluded from future sweeps).
    await tx.$executeRaw`
      UPDATE discounts d SET
        times_availed = GREATEST(0, d.times_availed - agg.cnt),
        total_discounted_minor = GREATEST(0, d.total_discounted_minor - agg.amt),
        updated_at = now()
      FROM (
        SELECT discount_id, COUNT(*)::int AS cnt, COALESCE(SUM(discount_amount_minor), 0)::int AS amt
        FROM booking_groups
        WHERE id = ANY(${ids}::uuid[]) AND discount_id IS NOT NULL
        GROUP BY discount_id
      ) agg
      WHERE d.id = agg.discount_id AND d.tenant_id = ${tenantId}::uuid
    `;
  }

  return lapsedGroups.map((g) => g.id);
}
