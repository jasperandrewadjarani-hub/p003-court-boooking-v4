import "server-only";
import type { Prisma } from "@/generated/prisma/client";

type JsonPayload = Record<string, string | number | boolean | null | undefined>;

/**
 * Every outbound email goes through this one function regardless of
 * transport — mirrors v2's queue-then-send pattern, and means switching
 * from dev-mode console output to real Resend delivery later (Phase F) is
 * a one-file change (src/lib/email/resend.ts), not a rearchitecture.
 */
export async function enqueueEmail(
  tx: Prisma.TransactionClient,
  tenantId: string,
  template: string,
  to: string,
  payload: JsonPayload
): Promise<void> {
  await tx.emailOutbox.create({
    data: { tenantId, template, toAddresses: [to], payload: payload as Prisma.InputJsonValue },
  });
}
