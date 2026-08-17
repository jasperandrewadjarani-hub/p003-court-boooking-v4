import "server-only";
import { withTenant } from "@/lib/tenant/withTenant";
import type { Prisma } from "@/generated/prisma/client";

export interface BlockSlotItem {
  courtId: string;
  startTime: string; // "HH:MM"
  endTime: string;
}

const ACTIVE_STATUSES = ["reserved", "confirmed", "checked_in", "playing"] as const;

/**
 * Admin "Block Time Slots" action (v3b BlockedSlotService.js's
 * adminSetSlotsBlocked, blocking direction). Rejects the whole batch if any
 * item is already blocked or already has an active booking overlapping it —
 * matches v3b's per-item pre-checks before writing rows.
 */
export async function blockSlots(tenantId: string, dateKey: string, items: BlockSlotItem[], staffUserId: string) {
  if (!items.length) throw new Error("No slots selected.");

  return withTenant(tenantId, async (tx) => {
    const localDate = new Date(dateKey + "T00:00:00.000Z");

    const existingBlocks = await tx.blockedSlot.findMany({ where: { tenantId, localDate } });
    const existingBookings = await tx.booking.findMany({
      where: { tenantId, localDate, status: { in: [...ACTIVE_STATUSES] as any } },
      select: { courtId: true, startsAt: true, endsAt: true },
    });

    const created: { id: string; courtId: string; startsAt: Date; endsAt: Date }[] = [];
    for (const item of items) {
      const startsAt = new Date(`${dateKey}T${item.startTime}:00.000Z`);
      const endsAt = new Date(`${dateKey}T${item.endTime}:00.000Z`);
      if (!(endsAt > startsAt)) throw new Error(`Invalid slot window: ${item.startTime}–${item.endTime}.`);

      const overlapsBlock = existingBlocks.some((b) => b.courtId === item.courtId && startsAt < b.endsAt && endsAt > b.startsAt);
      if (overlapsBlock) throw new Error(`${item.startTime}–${item.endTime} is already blocked on this court.`);

      const overlapsBooking = existingBookings.some((b) => b.courtId === item.courtId && startsAt < b.endsAt && endsAt > b.startsAt);
      if (overlapsBooking) throw new Error(`${item.startTime}–${item.endTime} already has an active booking on this court.`);

      const row = await tx.blockedSlot.create({
        data: { tenantId, courtId: item.courtId, localDate, startsAt, endsAt, reason: "Admin block", createdByUserId: staffUserId },
      });
      created.push(row);
      // Keep the in-memory list current so later items in this same batch
      // also see earlier items as blocked (prevents overlapping duplicate
      // blocks being created within one request).
      existingBlocks.push(row as any);
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: staffUserId,
        actorKind: "staff",
        entity: "blocked_slot",
        entityId: dateKey,
        action: "BLOCK_SLOTS",
        details: { dateKey, items, blockIds: created.map((c) => c.id) } as unknown as Prisma.InputJsonValue,
      },
    });

    return created;
  });
}

/** Admin "Unblock" action — deletes matching BlockedSlot rows by id. */
export async function unblockSlots(tenantId: string, blockIds: string[], staffUserId: string) {
  if (!blockIds.length) throw new Error("No blocks selected.");

  return withTenant(tenantId, async (tx) => {
    const result = await tx.blockedSlot.deleteMany({ where: { tenantId, id: { in: blockIds } } });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: staffUserId,
        actorKind: "staff",
        entity: "blocked_slot",
        entityId: blockIds[0],
        action: "UNBLOCK_SLOTS",
        details: { blockIds, deletedCount: result.count },
      },
    });

    return result;
  });
}
