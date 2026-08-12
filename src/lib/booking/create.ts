import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/tenant/withTenant";
import { calculatePrice } from "@/lib/pricing/calculate";
import { getBookingRules } from "@/lib/booking/availability";
import { Prisma } from "@/generated/prisma/client";

export interface CreateBookingInput {
  tenantId: string;
  dateKey: string; // "YYYY-MM-DD"
  courtId: string;
  startTime: string;
  endTime: string;
  players: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface CreateBookingResult {
  bookingGroupId: string;
  reference: string;
  totalMinor: number;
  courtName: string;
}

export class SlotTakenError extends Error {
  constructor() {
    super("That slot was just booked by someone else — pick another time.");
    this.name = "SlotTakenError";
  }
}

/**
 * NOTE — reduced scope for the "clickable slice" milestone. This is NOT
 * the full booking transaction from master plan §4.4: no idempotency-key
 * dedup on the client (one is generated here instead), no promo handling,
 * and customer identification is "find or create by email" with no
 * password/session at all — anyone who knows an email can act as that
 * customer. Real auth (Argon2id, email verification, sessions) is
 * unbuilt Phase 2 work. Do not treat a booking made through this path as
 * proof the real auth-gated flow works — it proves the booking
 * transaction and the exclusion constraint work, which was the point of
 * this slice.
 */
export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const rules = await getBookingRules(input.tenantId);

  const startMin = toMinutes(input.startTime);
  const endMin = toMinutes(input.endTime);
  const duration = endMin - startMin;
  if (duration < rules.minBookingMinutes) throw new Error(`Minimum booking length is ${rules.minBookingMinutes} minutes.`);
  if (duration > rules.maxBookingMinutes) throw new Error(`Maximum booking length is ${rules.maxBookingMinutes / 60} hours.`);
  if (startMin < rules.openHour * 60 || endMin > rules.closeHour * 60) throw new Error("Booking must fall within business hours.");

  // Pricing happens outside the transaction — it's read-only and doesn't
  // need to hold any lock (master plan §4.4: "pricing ... happens outside
  // the transaction, the inverse of v2 where all of it was inside the lock").
  const priceInputs = await withTenant(input.tenantId, async (tx) => {
    const court = await tx.court.findUnique({ where: { id: input.courtId } });
    if (!court) throw new Error("Court not found.");
    const priceMatrix = await tx.priceMatrixRow.findMany({ where: { tenantId: input.tenantId } });
    const holidays = await tx.holiday.findMany({ where: { tenantId: input.tenantId } });
    const memberships = await tx.membership.findMany({ where: { tenantId: input.tenantId } });
    return { court, priceMatrix, holidays, memberships };
  });

  const price = calculatePrice({
    court: { indoor: priceInputs.court.indoor, baseRateMinor: priceInputs.court.baseRateMinor, name: priceInputs.court.name },
    priceMatrix: priceInputs.priceMatrix.map((p) => ({
      dayType: p.dayType as "weekday" | "weekend",
      startTime: p.startTime,
      endTime: p.endTime,
      courtType: p.courtType as "indoor" | "outdoor",
      pricePerHourMinor: p.pricePerHourMinor,
    })),
    holidays: priceInputs.holidays.map((h) => ({ date: h.date.toISOString().slice(0, 10), name: h.name, rateMultiplier: Number(h.rateMultiplier) })),
    memberships: priceInputs.memberships.map((m) => ({ name: m.name, discountPercent: Number(m.discountPercent), active: m.active })),
    date: input.dateKey,
    startTime: input.startTime,
    endTime: input.endTime,
  });

  // Find or create the customer (by email) OUTSIDE the booking-write
  // transaction too — same reasoning, it's not part of the conflict-check
  // critical section.
  const customer = await withTenant(input.tenantId, async (tx) => {
    const normalizedEmail = input.email.trim().toLowerCase();
    const existingUser = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE tenant_id = ${input.tenantId}::uuid AND lower(email) = ${normalizedEmail} LIMIT 1
    `;
    if (existingUser.length) {
      const existingCustomer = await tx.customer.findUnique({ where: { userId: existingUser[0].id } });
      if (existingCustomer) return existingCustomer;
    }
    const user = await tx.user.create({
      data: { tenantId: input.tenantId, kind: "customer", email: normalizedEmail },
    });
    return tx.customer.create({
      data: {
        tenantId: input.tenantId,
        userId: user.id,
        firstName: input.firstName,
        lastName: input.lastName,
        mobileNumber: input.phone,
      },
    });
  });

  const startsAt = toUtcDate(input.dateKey, input.startTime);
  const endsAt = toUtcDate(input.dateKey, input.endTime);
  const idempotencyKey = crypto.randomUUID();

  try {
    const created = await withTenant(input.tenantId, async (tx) => {
      const group = await tx.bookingGroup.create({
        data: {
          tenantId: input.tenantId,
          customerId: customer.id,
          idempotencyKey,
          totalMinor: price.totalMinor,
        },
      });

      // The conflict check IS the exclusion constraint — this insert either
      // succeeds or raises 23P01. No application-level lock, no pre-check.
      await tx.booking.create({
        data: {
          tenantId: input.tenantId,
          bookingGroupId: group.id,
          courtId: input.courtId,
          startsAt,
          endsAt,
          turnoverBufferMinutes: rules.turnoverBufferMinutes,
          tz: "Asia/Manila", // snapshot; real per-tenant tz wiring is Phase 2 formal work
          durationMinutes: duration,
          players: input.players,
          priceMinor: price.totalMinor,
        },
      });

      // Reference generation — atomic, tiny, held for ~1ms (master plan §4.4
      // step 4). INSERT..ON CONFLICT..RETURNING is correct in one round trip
      // whether this is the day's first booking or the Nth: on first insert
      // next_seq becomes 2 (this claim used 1); on conflict it increments by
      // 1 and the claim is always `returned.next_seq - 1`.
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
          actorKind: "customer",
          entity: "booking_group",
          entityId: group.id,
          action: "CREATE",
          details: { reference, totalMinor: price.totalMinor },
        },
      });

      return { bookingGroupId: group.id, reference };
    });

    return { ...created, totalMinor: price.totalMinor, courtName: priceInputs.court.name };
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
