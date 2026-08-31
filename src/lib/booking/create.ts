import { withTenant } from "@/lib/tenant/withTenant";
import { calculateCartTotal, type CartDiscountInput } from "@/lib/pricing/calculate";
import { getBookingRules, gridWindowMinutes } from "@/lib/booking/availability";
import { sweepLapsedBookings } from "@/lib/booking/expiry";
import { quoteDiscount, consumeDiscount, type DiscountQuote } from "@/lib/booking/discounts";
import { Prisma } from "@/generated/prisma/client";

export interface CartItemInput {
  courtId: string;
  startTime: string; // "HH:MM"
  endTime: string;
}

export interface CreateBookingInput {
  tenantId: string;
  dateKey: string; // "YYYY-MM-DD"
  items: CartItemInput[];
  players: number; // v3b removed this field from storage — always hardcoded to 1 on insert, kept here only so existing callers don't need to change their payload shape
  customerId: string; // resolved server-side from the signed-in session (src/lib/auth/customerAuth.ts) — never trust a raw email field
  membershipType?: string;
  discountCode?: string;
  source?: "web_app" | "walk_in" | "phone" | "staff"; // default web_app
  staffUserId?: string; // set only when source is staff/walk_in (src/lib/admin/frontdesk.ts)
  notes?: string;
}

export interface CreateBookingResultItem {
  courtId: string;
  courtName: string;
  start: string;
  end: string;
  priceMinor: number;
}

export interface CreateBookingResult {
  bookingGroupId: string;
  reference: string;
  totalMinor: number;
  discountAmountMinor: number;
  items: CreateBookingResultItem[];
}

export class SlotTakenError extends Error {
  constructor() {
    // Exact v3b string (BookingService.js) — see parity/v3b_delta.md §3.8.
    super("That slot was recently booked by another customer and is no longer available. Please review your selection.");
    this.name = "SlotTakenError";
  }
}

/** v3b BookingService.js's assertCustomerPendingBookingLimit_ rejection —
 *  exact string, including v3b's pluralization rule (§3.3/§3.8). */
export class PendingLimitError extends Error {
  constructor(limit: number) {
    super(
      `Pending booking limit reached: you already have ${limit} pending booking${limit === 1 ? "" : "s"}. Please complete payment or wait for one to be confirmed before creating another booking.`
    );
    this.name = "PendingLimitError";
  }
}

/**
 * Customer identity is resolved server-side from the signed-in session
 * (src/lib/auth/customerAuth.ts's getCurrentCustomer()) by the caller
 * (src/app/actions.ts) BEFORE this function is ever called — this function
 * trusts `input.customerId` completely and does no lookup/creation of its
 * own, matching v2's "the signed-in email is the booking's customer,
 * period" model. Do not call this with a customerId that wasn't just
 * verified against an active session.
 *
 * Multi-item ("cart") semantics, matching v2's createBooking_: one checkout
 * can cover several courts and/or time slots at once. Every item becomes
 * its own `Booking` row, all sharing one `BookingGroup`. All-or-nothing is
 * free here — every item insert happens inside ONE Postgres transaction, and
 * the GiST exclusion constraint is checked per-insert including against the
 * transaction's own earlier inserts, so an internally-overlapping cart or a
 * cart racing another customer's booking both fail the same way (23P01) and
 * roll back the whole transaction. No manual "recheck under lock" needed —
 * v2 needed that because Apps Script's LockService is coarser than a real
 * database transaction; Postgres already gives this for free.
 *
 * Front-desk bypass (v3b BookingService.js, source === STAFF): skips
 * maxBookingMinutes, the business-hours-window check, maxAdvanceBookingDays,
 * the maxCourtHoursPerBooking cart cap, and the pending-limit check; uses a
 * 0-minute turnover buffer. minBookingMinutes is NEVER bypassed. Blocked-slot
 * and conflict checks are NEVER bypassed, even for staff — admin authority
 * never permits double-booking or booking a blocked slot.
 */
export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  if (!input.items.length) throw new Error("Cart is empty.");

  const rules = await getBookingRules(input.tenantId);
  const isStaff = input.source === "staff";

  const [customerOpenMin, customerCloseMin] = gridWindowMinutes(rules.customerGridStartTime, rules.customerGridEndTime);

  let totalHours = 0;
  for (const item of input.items) {
    const startMin = toMinutes(item.startTime);
    const endMin = toMinutes(item.endTime);
    const duration = endMin - startMin;
    // Minimum booking length is enforced for every source, staff included —
    // v3b's validateBookingWindow_ never bypasses MIN_BOOKING_MINUTES.
    if (duration < rules.minBookingMinutes) throw new Error(`Minimum booking length is ${rules.minBookingMinutes} minutes.`);
    if (!isStaff) {
      if (duration > rules.maxBookingMinutes) throw new Error(`Maximum booking length is ${rules.maxBookingMinutes / 60} hours.`);
      if (startMin < customerOpenMin || endMin > customerCloseMin) throw new Error("Booking must fall within business hours.");
    }
    totalHours += duration / 60;
  }

  if (!isStaff) {
    const todayKey = new Date().toISOString().slice(0, 10);
    const advanceDays = Math.floor(
      (new Date(input.dateKey + "T00:00:00.000Z").getTime() - new Date(todayKey + "T00:00:00.000Z").getTime()) / 86400000
    );
    if (advanceDays > rules.maxAdvanceBookingDays) {
      throw new Error(`Bookings can only be made up to ${rules.maxAdvanceBookingDays} days in advance.`);
    }
    if (totalHours > rules.maxCourtHoursPerBooking) {
      throw new Error(`A single booking can cover at most ${rules.maxCourtHoursPerBooking} court-hours — remove an item or split into two bookings.`);
    }
  }

  // Buffer is bypassed (0) for staff bookings — v3b: bufferMin = cart.source
  // === STAFF ? 0 : CFG_().BUFFER_MINUTES.
  const bufferMinutes = isStaff ? 0 : rules.turnoverBufferMinutes;

  // Pricing (+ a non-consuming discount preview, if a code was supplied)
  // happens outside the transaction — read-only, no lock needed (master plan
  // §4.4: "pricing ... happens outside the transaction, the inverse of v2
  // where all of it was inside the lock"). The discount is re-quoted AND
  // atomically consumed for real inside the transaction below, matching
  // v3b's "increment only after rows append successfully, under lock".
  const { cart, courtsById } = await priceCart(input.tenantId, input.dateKey, input.items, input.membershipType, rules.taxRatePercent, input.discountCode);

  const idempotencyKey = crypto.randomUUID();

  try {
    const created = await withTenant(input.tenantId, async (tx) => {
      // Same lazy-expiry sweep as the grid read — without this, a cart could
      // spuriously fail against a slot someone else abandoned but nobody has
      // viewed the grid for since (no cron has run to release it).
      await sweepLapsedBookings(tx, input.tenantId, rules);

      // Pending-booking limit (v3b assertCustomerPendingBookingLimit_) —
      // non-staff only, re-checked inside the transaction so two concurrent
      // requests from the same customer can't both slip past it.
      if (!isStaff) {
        const pendingCount = await tx.bookingGroup.count({
          where: { tenantId: input.tenantId, customerId: input.customerId, status: "reserved", source: { not: "staff" } },
        });
        if (pendingCount >= rules.maxPendingCustomerBookings) {
          throw new PendingLimitError(rules.maxPendingCustomerBookings);
        }
      }

      // Blocked-slot check — ALL sources, including staff (admin authority
      // never permits booking a blocked slot). Rejects the whole cart on any
      // overlap, matching v3b's blockedSlotOverlaps_ check inside the lock.
      const dayBlocks = await tx.blockedSlot.findMany({
        where: { tenantId: input.tenantId, localDate: new Date(input.dateKey + "T00:00:00.000Z") },
        select: { courtId: true, startsAt: true, endsAt: true },
      });
      for (const item of input.items) {
        const itemStart = toUtcDate(input.dateKey, item.startTime);
        const itemEnd = toUtcDate(input.dateKey, item.endTime);
        const overlapsBlock = dayBlocks.some((b) => b.courtId === item.courtId && itemStart < b.endsAt && itemEnd > b.startsAt);
        if (overlapsBlock) throw new SlotTakenError();
      }

      const group = await tx.bookingGroup.create({
        data: {
          tenantId: input.tenantId,
          customerId: input.customerId,
          idempotencyKey,
          totalMinor: cart.totalMinor,
          source: input.source ?? "web_app",
          staffUserId: input.staffUserId,
          notes: input.notes,
        },
      });

      // The conflict check IS the exclusion constraint — each insert either
      // succeeds or raises 23P01. An overlap against an already-committed
      // row OR against an earlier insert in this same cart both fail here,
      // rolling back every row created so far in this transaction.
      const createdItems: CreateBookingResultItem[] = [];
      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        const court = courtsById.get(item.courtId)!;
        const startsAt = toUtcDate(input.dateKey, item.startTime);
        const endsAt = toUtcDate(input.dateKey, item.endTime);
        // Row price stays GROSS — undiscounted by the promo code, which is
        // subtracted exactly once at the group level (discountAmountMinor)
        // instead, matching v3b's "Price Basis: Gross" convention.
        const priceMinor = cart.items[i].totalMinor;

        await tx.booking.create({
          data: {
            tenantId: input.tenantId,
            bookingGroupId: group.id,
            courtId: item.courtId,
            startsAt,
            endsAt,
            turnoverBufferMinutes: bufferMinutes,
            tz: "Asia/Manila", // snapshot; real per-tenant tz wiring is Phase 2 formal work
            durationMinutes: toMinutes(item.endTime) - toMinutes(item.startTime),
            players: 1, // v3b removed Number of Players from storage — always 1
            priceMinor,
          },
        });

        createdItems.push({ courtId: item.courtId, courtName: court.name, start: item.startTime, end: item.endTime, priceMinor });
      }

      // Discount consumption — AFTER rows are inserted, atomically, matching
      // v3b's "increment only after rows append successfully, under lock." A
      // failed consume (exhausted between the preview quote and now) rolls
      // back the whole transaction — no partial booking is ever left behind.
      let discountAmountMinor = 0;
      let appliedDiscountId: string | undefined;
      let appliedDiscountCode: string | undefined;
      if (input.discountCode) {
        const taxableBeforePromo = cart.subtotalMinor - cart.membershipDiscountMinor;
        const quote = await quoteDiscount(tx, input.tenantId, input.discountCode, taxableBeforePromo, cart.totalHours);
        const consumed = await consumeDiscount(tx, input.tenantId, quote.discountId);
        if (!consumed) {
          throw new Error(`Discount code "${quote.code}" just reached its usage limit — please remove it and try again.`);
        }
        discountAmountMinor = quote.amountMinor;
        appliedDiscountId = quote.discountId;
        appliedDiscountCode = quote.code;
      }

      // Reference generation — atomic, tiny, held once per GROUP (not once
      // per item) — master plan §4.4 step 4.
      const dateForSeq = new Date(input.dateKey + "T00:00:00.000Z");
      const seqResult = await tx.$queryRaw<{ next_seq: number }[]>`
        INSERT INTO booking_sequences (tenant_id, local_date, next_seq)
        VALUES (${input.tenantId}::uuid, ${dateForSeq}, 2)
        ON CONFLICT (tenant_id, local_date) DO UPDATE SET next_seq = booking_sequences.next_seq + 1
        RETURNING next_seq
      `;
      const seq = seqResult[0].next_seq - 1;
      const datePart = input.dateKey.replace(/-/g, "");
      const reference = `BK-${datePart}-${String(seq).padStart(3, "0")}`;

      await tx.bookingGroup.update({
        where: { id: group.id },
        data: {
          reference,
          discountId: appliedDiscountId,
          discountCode: appliedDiscountCode,
          discountAmountMinor,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorUserId: input.staffUserId,
          actorKind: input.staffUserId ? "staff" : "customer",
          entity: "booking_group",
          entityId: group.id,
          action: "CREATE",
          details: { reference, totalMinor: cart.totalMinor, discountAmountMinor, itemCount: createdItems.length },
        },
      });

      return { bookingGroupId: group.id, reference, items: createdItems, discountAmountMinor };
    });

    return { ...created, totalMinor: cart.totalMinor };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2010" && String(err.meta?.code) === "23P01") {
      throw new SlotTakenError();
    }
    // Postgres exclusion violations can also surface as a generic raw-query
    // error depending on driver path — check the underlying code directly too.
    if ((err as any)?.code === "23P01" || (err as any)?.meta?.driverAdapterError?.cause?.code === "23P01") {
      throw new SlotTakenError();
    }
    throw err;
  }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function toUtcDate(dateKey: string, time: string): Date {
  return new Date(`${dateKey}T${time}:00.000Z`);
}

/**
 * Shared cart-pricing fetch+calculate, used by createBooking() (the
 * authority) AND the live-preview server action (src/app/actions.ts) — one
 * implementation, so a customer's pre-checkout preview can never drift from
 * what they're actually charged. Read-only, no transaction lock needed.
 *
 * When `discountCode` is supplied, resolves a non-consuming DiscountQuote
 * (see src/lib/booking/discounts.ts) against the cart's own
 * taxable-before-promo amount and feeds it into calculateCartTotal — the
 * same discount resolution createBooking() re-runs (and actually consumes)
 * inside its transaction, so preview and reality can never disagree except
 * for the one legitimate race (another request exhausting the code between
 * preview and commit), which createBooking() catches separately.
 */
export async function priceCart(
  tenantId: string,
  dateKey: string,
  items: CartItemInput[],
  membershipType?: string,
  taxRatePercent?: number,
  discountCode?: string
) {
  const courtIds = [...new Set(items.map((i) => i.courtId))];
  const priceInputs = await withTenant(tenantId, async (tx) => {
    const courts = await tx.court.findMany({ where: { tenantId, id: { in: courtIds } }, omit: { imageUrl: true } });
    const priceMatrix = await tx.priceMatrixRow.findMany({ where: { tenantId } });
    const holidays = await tx.holiday.findMany({ where: { tenantId } });
    const memberships = await tx.membership.findMany({ where: { tenantId } });
    return { courts, priceMatrix, holidays, memberships };
  });

  const courtsById = new Map(priceInputs.courts.map((c) => [c.id, c]));
  for (const item of items) {
    if (!courtsById.has(item.courtId)) throw new Error("Court not found.");
  }

  const cartItems = items.map((item) => {
    const court = courtsById.get(item.courtId)!;
    return { court: { id: court.id, indoor: court.indoor, baseRateMinor: court.baseRateMinor, name: court.name }, startTime: item.startTime, endTime: item.endTime };
  });

  const sharedBase = {
    priceMatrix: priceInputs.priceMatrix
      .filter((p) => p.courtId)
      .map((p) => ({
        courtId: p.courtId as string,
        dayType: p.dayType as "weekday" | "weekend" | "all",
        startTime: p.startTime,
        endTime: p.endTime,
        pricePerHourMinor: p.pricePerHourMinor,
      })),
    holidays: priceInputs.holidays.map((h) => ({ date: h.date.toISOString().slice(0, 10), name: h.name, rateMultiplier: Number(h.rateMultiplier) })),
    memberships: priceInputs.memberships.map((m) => ({ name: m.name, discountPercent: Number(m.discountPercent), active: m.active })),
    date: dateKey,
    membershipType,
    taxRatePercent,
  };

  let discountQuote: DiscountQuote | null = null;
  if (discountCode) {
    // First pass (no discount) just to derive taxableBeforePromo for the quote.
    const undiscounted = calculateCartTotal(cartItems, sharedBase);
    const taxableBeforePromo = undiscounted.subtotalMinor - undiscounted.membershipDiscountMinor;
    discountQuote = await withTenant(tenantId, (tx) => quoteDiscount(tx, tenantId, discountCode, taxableBeforePromo, undiscounted.totalHours));
  }

  const discountInput: CartDiscountInput | null = discountQuote ? { type: discountQuote.type, value: discountQuote.value } : null;
  const cart = calculateCartTotal(cartItems, { ...sharedBase, discount: discountInput });

  return { cart, courtsById, discountQuote };
}
