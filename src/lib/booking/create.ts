import { withTenant } from "@/lib/tenant/withTenant";
import { calculateCartTotal } from "@/lib/pricing/calculate";
import { getBookingRules } from "@/lib/booking/availability";
import { sweepLapsedBookings } from "@/lib/booking/expiry";
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
  players: number;
  customerId: string; // resolved server-side from the signed-in session (src/lib/auth/customerAuth.ts) — never trust a raw email field
  membershipType?: string;
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
  items: CreateBookingResultItem[];
}

export class SlotTakenError extends Error {
  constructor() {
    super("One or more of those slots was just booked by someone else — the whole booking was cancelled, pick different times.");
    this.name = "SlotTakenError";
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
 */
export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  if (!input.items.length) throw new Error("Cart is empty.");

  const rules = await getBookingRules(input.tenantId);

  let totalHours = 0;
  for (const item of input.items) {
    const startMin = toMinutes(item.startTime);
    const endMin = toMinutes(item.endTime);
    const duration = endMin - startMin;
    if (duration < rules.minBookingMinutes) throw new Error(`Minimum booking length is ${rules.minBookingMinutes} minutes.`);
    if (duration > rules.maxBookingMinutes) throw new Error(`Maximum booking length is ${rules.maxBookingMinutes / 60} hours.`);
    if (startMin < rules.openHour * 60 || endMin > rules.closeHour * 60) throw new Error("Booking must fall within business hours.");
    totalHours += duration / 60;
  }
  if (totalHours > rules.maxCourtHoursPerBooking) {
    throw new Error(`A single booking can cover at most ${rules.maxCourtHoursPerBooking} court-hours — remove an item or split into two bookings.`);
  }

  // Pricing happens outside the transaction — read-only, no lock needed
  // (master plan §4.4: "pricing ... happens outside the transaction, the
  // inverse of v2 where all of it was inside the lock").
  const { cart, courtsById } = await priceCart(input.tenantId, input.dateKey, input.items, input.membershipType);

  const idempotencyKey = crypto.randomUUID();

  try {
    const created = await withTenant(input.tenantId, async (tx) => {
      // Same lazy-expiry sweep as the grid read — without this, a cart could
      // spuriously fail against a slot someone else abandoned but nobody has
      // viewed the grid for since (no cron has run to release it).
      await sweepLapsedBookings(tx, input.tenantId, rules);

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
        const priceMinor = cart.items[i].totalMinor;

        await tx.booking.create({
          data: {
            tenantId: input.tenantId,
            bookingGroupId: group.id,
            courtId: item.courtId,
            startsAt,
            endsAt,
            turnoverBufferMinutes: rules.turnoverBufferMinutes,
            tz: "Asia/Manila", // snapshot; real per-tenant tz wiring is Phase 2 formal work
            durationMinutes: toMinutes(item.endTime) - toMinutes(item.startTime),
            players: input.players,
            priceMinor,
          },
        });

        createdItems.push({ courtId: item.courtId, courtName: court.name, start: item.startTime, end: item.endTime, priceMinor });
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

      await tx.bookingGroup.update({ where: { id: group.id }, data: { reference } });

      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorUserId: input.staffUserId,
          actorKind: input.staffUserId ? "staff" : "customer",
          entity: "booking_group",
          entityId: group.id,
          action: "CREATE",
          details: { reference, totalMinor: cart.totalMinor, itemCount: createdItems.length },
        },
      });

      return { bookingGroupId: group.id, reference, items: createdItems };
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
 */
export async function priceCart(tenantId: string, dateKey: string, items: CartItemInput[], membershipType?: string) {
  const courtIds = [...new Set(items.map((i) => i.courtId))];
  const priceInputs = await withTenant(tenantId, async (tx) => {
    const courts = await tx.court.findMany({ where: { tenantId, id: { in: courtIds } } });
    const priceMatrix = await tx.priceMatrixRow.findMany({ where: { tenantId } });
    const holidays = await tx.holiday.findMany({ where: { tenantId } });
    const memberships = await tx.membership.findMany({ where: { tenantId } });
    return { courts, priceMatrix, holidays, memberships };
  });

  const courtsById = new Map(priceInputs.courts.map((c) => [c.id, c]));
  for (const item of items) {
    if (!courtsById.has(item.courtId)) throw new Error("Court not found.");
  }

  const cart = calculateCartTotal(
    items.map((item) => {
      const court = courtsById.get(item.courtId)!;
      return { court: { indoor: court.indoor, baseRateMinor: court.baseRateMinor, name: court.name }, startTime: item.startTime, endTime: item.endTime };
    }),
    {
      priceMatrix: priceInputs.priceMatrix.map((p) => ({
        dayType: p.dayType as "weekday" | "weekend",
        startTime: p.startTime,
        endTime: p.endTime,
        courtType: p.courtType as "indoor" | "outdoor",
        pricePerHourMinor: p.pricePerHourMinor,
      })),
      holidays: priceInputs.holidays.map((h) => ({ date: h.date.toISOString().slice(0, 10), name: h.name, rateMultiplier: Number(h.rateMultiplier) })),
      memberships: priceInputs.memberships.map((m) => ({ name: m.name, discountPercent: Number(m.discountPercent), active: m.active })),
      date: dateKey,
      membershipType,
    }
  );

  return { cart, courtsById };
}
