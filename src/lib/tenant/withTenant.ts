import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Every tenant-scoped query goes through this. Sets app.tenant_id as
 * transaction-local (the third `true` argument to set_config) — a
 * session-level SET would persist on a pooled connection and leak into the
 * next tenant's request, which is exactly the trap the isolation model
 * exists to prevent (master plan §5.1). Never call set_config directly
 * outside this wrapper.
 */
export function withTenant<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}
