import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Runtime queries use the POOLED connection (PgBouncer, port 6543 on
// Supabase) — this is deliberately a different env var and a different
// connection than prisma.config.ts uses for migrations. See
// prisma.config.ts's header comment for why mixing these up breaks things.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Next.js dev-mode hot-reload re-evaluates this module on every edit; without
// caching on `global`, each reload opens a new pool against the pooled
// connection until it's exhausted. Production (one process per invocation)
// doesn't need this guard but it's harmless there.
export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
