// Reconcile each discount's usage counters (timesAvailed + totalDiscountedMinor)
// to reflect ONLY currently-counting bookings — i.e. exclude cancelled/lapsed
// ones. Establishes the invariant the app now maintains via releaseDiscount, and
// corrects any pre-existing drift (bookings that lapsed/were cancelled before the
// release logic existed but still counted).
//
// Counting = status NOT IN ('cancelled','lapsed') — matches discountCountsForStatus.
//
// Usage:
//   npx tsx scripts/reconcile-discount-usage.mjs            # dry-run
//   npx tsx scripts/reconcile-discount-usage.mjs --commit

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

const COMMIT = process.argv.includes("--commit");

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) });
  try {
    const discounts = await prisma.discount.findMany({ select: { id: true, tenantId: true, code: true, timesAvailed: true, totalDiscountedMinor: true } });
    console.log(`Discounts: ${discounts.length}  |  mode: ${COMMIT ? "COMMIT" : "DRY-RUN"}\n`);
    let changed = 0;
    for (const d of discounts) {
      const active = await prisma.bookingGroup.findMany({
        where: { tenantId: d.tenantId, discountId: d.id, status: { notIn: ["cancelled", "lapsed"] } },
        select: { discountAmountMinor: true },
      });
      const cnt = active.length;
      const amt = active.reduce((s, g) => s + (g.discountAmountMinor || 0), 0);
      const drift = cnt !== d.timesAvailed || amt !== d.totalDiscountedMinor;
      console.log(`  ${d.code.padEnd(16)} used ${d.timesAvailed}->${cnt}  given PHP ${(d.totalDiscountedMinor / 100).toFixed(2)}->${(amt / 100).toFixed(2)}${drift ? "  *" : ""}`);
      if (drift && COMMIT) {
        await prisma.discount.update({ where: { id: d.id }, data: { timesAvailed: cnt, totalDiscountedMinor: amt } });
        changed++;
      } else if (drift) {
        changed++;
      }
    }
    console.log(`\n${COMMIT ? "Updated" : "Would update"} ${changed} discount(s).`);
    if (!COMMIT) console.log("Re-run with --commit to apply.");
    await prisma.$disconnect();
  } catch (e) {
    await prisma.$disconnect();
    console.error("\nERROR:", e.message);
    process.exit(1);
  }
}

main();
