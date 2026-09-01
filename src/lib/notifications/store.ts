import "server-only";
import { randomUUID } from "crypto";
import type { Prisma } from "@/generated/prisma/client";
import { withTenant } from "@/lib/tenant/withTenant";

// Notification kinds. Generation always writes the row; the ADMIN bell filters
// staff rows by the tenant's in-app settings at display time (so toggling a
// type off just hides it, and toggling back on reveals history).
export type NotifType =
  | "booking_received"
  | "payment_received"
  | "booking_confirmed"
  | "booking_cancelled"
  | "booking_lapsed"
  | "payment_awaiting";

export interface NotifArgs {
  audience: "staff" | "customer";
  customerId?: string | null;
  type: NotifType;
  bookingGroupId?: string | null;
  title: string;
  body: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  bookingGroupId: string | null;
  customerName?: string | null; // shown on the admin bell (who the booking is for)
  read: boolean;
  createdAt: string; // ISO
}

/** Insert one notification inside an existing transaction. */
export async function createNotification(tx: Prisma.TransactionClient, tenantId: string, a: NotifArgs): Promise<void> {
  await tx.notification.create({
    data: {
      id: randomUUID(),
      tenantId,
      audience: a.audience,
      customerId: a.customerId ?? null,
      type: a.type,
      bookingGroupId: a.bookingGroupId ?? null,
      title: a.title,
      body: a.body,
    },
  });
}

/** Bulk insert (used by the lapse sweep, which can produce many at once). */
export async function createManyNotifications(tx: Prisma.TransactionClient, tenantId: string, rows: NotifArgs[]): Promise<void> {
  if (!rows.length) return;
  await tx.notification.createMany({
    data: rows.map((a) => ({
      id: randomUUID(),
      tenantId,
      audience: a.audience,
      customerId: a.customerId ?? null,
      type: a.type,
      bookingGroupId: a.bookingGroupId ?? null,
      title: a.title,
      body: a.body,
    })),
  });
}

function mapNotif(n: any): NotificationItem {
  return { id: n.id, type: n.type, title: n.title, body: n.body, bookingGroupId: n.bookingGroupId ?? null, read: !!n.readAt, createdAt: n.createdAt.toISOString() };
}

export interface NotificationsResult {
  items: NotificationItem[];
  unreadCount: number;
}

/** Staff (shared tenant) inbox — filtered to the enabled types. */
export async function listStaffNotifications(tenantId: string, enabledTypes: string[], limit = 30): Promise<NotificationsResult> {
  const types = enabledTypes.length ? enabledTypes : ["__none__"]; // empty selection = show nothing
  return withTenant(tenantId, async (tx) => {
    const where = { tenantId, audience: "staff", type: { in: types } } as const;
    const [rows, unreadCount] = await Promise.all([
      tx.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
      tx.notification.count({ where: { ...where, readAt: null } }),
    ]);
    // Attach the booking's customer name (who it's for) for the admin bell.
    const bgIds = [...new Set(rows.map((n) => n.bookingGroupId).filter(Boolean))] as string[];
    const groups = bgIds.length
      ? await tx.bookingGroup.findMany({ where: { tenantId, id: { in: bgIds } }, select: { id: true, customer: { select: { firstName: true, lastName: true } } } })
      : [];
    const nameById = new Map(groups.map((g) => [g.id, `${g.customer.firstName} ${g.customer.lastName}`.trim()]));
    const items = rows.map((n) => ({ ...mapNotif(n), customerName: n.bookingGroupId ? nameById.get(n.bookingGroupId) ?? null : null }));
    return { items, unreadCount };
  });
}

/** One customer's own inbox. */
export async function listCustomerNotifications(tenantId: string, customerId: string, limit = 30): Promise<NotificationsResult> {
  return withTenant(tenantId, async (tx) => {
    const where = { tenantId, audience: "customer", customerId } as const;
    const [items, unreadCount] = await Promise.all([
      tx.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
      tx.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return { items: items.map(mapNotif), unreadCount };
  });
}

export async function markStaffNotificationsRead(tenantId: string, ids?: string[]): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.notification.updateMany({
      where: { tenantId, audience: "staff", readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    })
  );
}

export async function markCustomerNotificationsRead(tenantId: string, customerId: string, ids?: string[]): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.notification.updateMany({
      where: { tenantId, audience: "customer", customerId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    })
  );
}
