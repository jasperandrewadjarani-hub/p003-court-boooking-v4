// Additive recurring-league import for Dink & Dunk (P003 v4).
//
// Creates weekly recurring league bookings from START to END (inclusive) as
// Confirmed + Unpaid booking groups (source=staff, turnover buffer 0 — see
// notes.md gotcha 5), priced from each court's live price matrix / base rate
// using the app's OWN calculatePrice (imported below, so grid/admin amounts
// match to the centavo).
//
// SAFE BY DESIGN:
//   • ADDITIVE — never deletes or resets anything (unlike import-2026-grid).
//   • IDEMPOTENT — each (league, date) group has a deterministic reference /
//     idempotencyKey ("LEAG-<ABBR>-<YYYYMMDD>"); a re-run skips groups that
//     already exist, so running twice does not double-book.
//   • CONFLICT-SAFE — rows insert individually; a GiST-exclusion clash with an
//     existing booking is caught and that ONE row is skipped and reported (the
//     rest of the group still lands). A group that ends up with zero inserted
//     rows is removed rather than left orphaned.
//   • Dry-run by default. Prints a full plan and writes NOTHING without --commit.
//
// Usage:
//   node scripts/import-leagues.mjs            # dry-run: plan + report, ZERO writes
//   node scripts/import-leagues.mjs --commit   # perform the additive import
//
// Connects via DIRECT_URL (non-pooled migration/owner role, bypasses RLS) like
// import-2026-grid.mjs / prisma/seed.ts.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "crypto";
import { calculatePrice } from "../src/lib/pricing/calculate.ts";

const SLUG = "dink-and-dunk";
const TZ = "Asia/Manila";
const START = "2026-08-31"; // "today" per the request
const END = "2026-12-31"; // "to December" = through end of December
const COMMIT = process.argv.includes("--commit");

const pad2 = (n) => String(n).padStart(2, "0");

// Court-code helpers: A-E -> DND-CA..CE, 1-6 -> DND-C1..C6.
const CA = (...ls) => ls.map((l) => `DND-C${l}`); // letters
const CN = (...ns) => ns.map((n) => `DND-C${n}`); // numbers

// Day-of-week: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6.
// endHour 24 == midnight (booking ends next calendar day 00:00; the play date
// stays this date via the local_date trigger — see notes.md gotcha 15).
const SEGMENTS = [
  { league: "Palo", abbr: "PALO", days: [1, 3, 5], courts: CA("A", "B", "C", "D", "E"), start: 19, end: 23 },
  { league: "Picklebelles and Bros", abbr: "PBB", days: [2, 4, 6], courts: CA("A", "B", "C", "D", "E"), start: 20, end: 24 },
  { league: "Dinkininis", abbr: "DINK", days: [6], courts: CN(1, 2, 3), start: 18, end: 24 },
  { league: "PWL", abbr: "PWL", days: [2, 4], courts: CN(1, 2, 3), start: 19, end: 22 },
  { league: "PWL", abbr: "PWL", days: [0], courts: CN(1, 2, 3, 4, 5, 6), start: 19, end: 22 },
  { league: "Rh", abbr: "RH", days: [1], courts: CN(1, 4, 5, 6), start: 18, end: 20 },
  { league: "Pincers", abbr: "PINC", days: [1], courts: CN(1, 2, 3), start: 20, end: 23 },
  { league: "Pincers", abbr: "PINC", days: [1], courts: CN(2, 3), start: 19, end: 20 },
  { league: "Pincers", abbr: "PINC", days: [5], courts: CN(1, 2, 3), start: 19, end: 23 },
];

// One customer per league (created if missing; matched by a stable marker email).
const LEAGUES = [...new Set(SEGMENTS.map((s) => s.league))];
const leagueEmail = (name) => `league-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}@leagues.dnd`;

function eachDate(startStr, endStr) {
  const out = [];
  let d = new Date(`${startStr}T00:00:00.000Z`);
  const end = new Date(`${endStr}T00:00:00.000Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}
const dow = (dateKey) => new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
  const prisma = new PrismaClient({ adapter });
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
    if (!tenant) throw new Error(`Tenant "${SLUG}" not found.`);
    const tid = tenant.id;

    const courts = await prisma.court.findMany({ where: { tenantId: tid } });
    const courtByCode = Object.fromEntries(courts.map((c) => [c.code, c]));
    const neededCodes = [...new Set(SEGMENTS.flatMap((s) => s.courts))];
    const missing = neededCodes.filter((code) => !courtByCode[code]);
    if (missing.length) throw new Error(`Courts missing in tenant: ${missing.join(", ")}`);

    // Pricing inputs (shared across all rows) — the app's own shapes.
    const priceMatrixRaw = await prisma.priceMatrixRow.findMany({ where: { tenantId: tid } });
    const holidaysRaw = await prisma.holiday.findMany({ where: { tenantId: tid } });
    const priceMatrix = priceMatrixRaw
      .filter((p) => p.courtId)
      .map((p) => ({ courtId: p.courtId, dayType: p.dayType, startTime: p.startTime, endTime: p.endTime, pricePerHourMinor: p.pricePerHourMinor }));
    const holidays = holidaysRaw.map((h) => ({ date: h.date.toISOString().slice(0, 10), name: h.name, rateMultiplier: Number(h.rateMultiplier) }));

    console.log(`Tenant: ${tenant.name} (${tid}) — ${courts.length} courts`);
    console.log(`Range: ${START} → ${END}  |  mode: ${COMMIT ? "COMMIT (writing)" : "DRY-RUN (no writes)"}`);

    // ---- Build the plan: group rows by (league|date) ----------------------------
    const dates = eachDate(START, END);
    const groups = new Map(); // key "abbr|date" -> { league, abbr, dateKey, rows: [{courtCode, start, end}] }
    for (const dateKey of dates) {
      const wd = dow(dateKey);
      for (const seg of SEGMENTS) {
        if (!seg.days.includes(wd)) continue;
        const key = `${seg.abbr}|${dateKey}`;
        if (!groups.has(key)) groups.set(key, { league: seg.league, abbr: seg.abbr, dateKey, rows: [] });
        for (const courtCode of seg.courts) {
          groups.get(key).rows.push({ courtCode, start: seg.start, end: seg.end });
        }
      }
    }

    // ---- Price every row + collect any pricing gaps -----------------------------
    const priceErrors = [];
    const perLeague = {}; // league -> { groups, rows, hours, pesosMinor }
    for (const g of groups.values()) {
      for (const r of g.rows) {
        const court = courtByCode[r.courtCode];
        try {
          const res = calculatePrice({
            court: { id: court.id, indoor: court.indoor, baseRateMinor: court.baseRateMinor, name: court.name },
            priceMatrix,
            holidays,
            memberships: [],
            date: g.dateKey,
            startTime: `${pad2(r.start)}:00`,
            endTime: r.end === 24 ? "24:00" : `${pad2(r.end)}:00`,
          });
          r.priceMinor = res.subtotalMinor;
          r.hours = res.hours;
        } catch (e) {
          r.priceMinor = null;
          r.hours = r.end - r.start;
          priceErrors.push(`${g.league} ${g.dateKey} ${court.code} ${r.start}-${r.end}: ${e.message}`);
        }
        const pl = (perLeague[g.league] ??= { groups: new Set(), rows: 0, hours: 0, pesosMinor: 0 });
        pl.groups.add(`${g.abbr}|${g.dateKey}`);
        pl.rows += 1;
        pl.hours += r.hours;
        pl.pesosMinor += r.priceMinor ?? 0;
      }
    }

    // ---- Report -----------------------------------------------------------------
    console.log("\nPlan by league:");
    for (const league of LEAGUES) {
      const pl = perLeague[league];
      if (!pl) continue;
      console.log(`  ${league.padEnd(24)} groups=${String(pl.groups.size).padStart(3)}  rows=${String(pl.rows).padStart(4)}  hours=${String(pl.hours).padStart(4)}  = PHP ${(pl.pesosMinor / 100).toLocaleString()}`);
    }
    const totalRows = Object.values(perLeague).reduce((s, p) => s + p.rows, 0);
    const totalGroups = groups.size;
    const totalPesos = Object.values(perLeague).reduce((s, p) => s + p.pesosMinor, 0);
    console.log(`  ${"TOTAL".padEnd(24)} groups=${String(totalGroups).padStart(3)}  rows=${String(totalRows).padStart(4)}  = PHP ${(totalPesos / 100).toLocaleString()}`);

    if (priceErrors.length) {
      console.log(`\n⚠ ${priceErrors.length} row(s) have NO configured price (would insert at PHP 0 or fail):`);
      for (const e of priceErrors.slice(0, 20)) console.log(`    - ${e}`);
      if (priceErrors.length > 20) console.log(`    ...and ${priceErrors.length - 20} more`);
    }

    if (!COMMIT) {
      console.log("\nDRY-RUN complete — no rows written. Re-run with --commit to apply.");
      await prisma.$disconnect();
      return;
    }

    if (priceErrors.length) {
      throw new Error(`Refusing to commit: ${priceErrors.length} row(s) have no configured price. Fix the price matrix / base rates first (or tell me to insert those at PHP 0).`);
    }

    // ---- Ensure league customers ------------------------------------------------
    const custIdByLeague = {};
    for (const league of LEAGUES) {
      const email = leagueEmail(league);
      const existing = await prisma.user.findFirst({ where: { tenantId: tid, email }, include: { customer: true } });
      if (existing?.customer) {
        custIdByLeague[league] = existing.customer.id;
        continue;
      }
      const userId = existing?.id ?? randomUUID();
      if (!existing) {
        await prisma.user.create({ data: { id: userId, tenantId: tid, kind: "customer", email, emailVerifiedAt: new Date() } });
      }
      const customerId = randomUUID();
      await prisma.customer.create({ data: { id: customerId, tenantId: tid, userId, firstName: league, lastName: "(League)", registeredAt: new Date() } });
      custIdByLeague[league] = customerId;
    }
    console.log(`\nLeague customers ready: ${LEAGUES.length}`);

    // ---- Insert groups + rows (idempotent + conflict-safe) ----------------------
    let groupsCreated = 0, groupsSkipped = 0, rowsOk = 0, rowsSkipped = 0, emptyRemoved = 0;
    for (const g of groups.values()) {
      const reference = `LEAG-${g.abbr}-${g.dateKey.replace(/-/g, "")}`;
      const existing = await prisma.bookingGroup.findFirst({ where: { tenantId: tid, idempotencyKey: reference } });
      if (existing) { groupsSkipped++; continue; }

      const groupId = randomUUID();
      await prisma.bookingGroup.create({
        data: {
          id: groupId, tenantId: tid, reference, idempotencyKey: reference,
          customerId: custIdByLeague[g.league],
          status: "confirmed", paymentStatus: "unpaid", source: "staff",
          totalMinor: 0, amountPaidMinor: 0, discountAmountMinor: 0,
          notes: `${g.league} — recurring league booking`,
          createdAt: new Date(`${g.dateKey}T08:00:00.000Z`),
        },
      });

      let insertedTotal = 0, insertedCount = 0;
      for (const r of g.rows) {
        const court = courtByCode[r.courtCode];
        const startsAt = new Date(`${g.dateKey}T${pad2(r.start)}:00:00.000Z`);
        const endsAt = new Date(startsAt.getTime() + (r.end - r.start) * 3600 * 1000);
        try {
          await prisma.booking.create({
            data: {
              id: randomUUID(), tenantId: tid, bookingGroupId: groupId, courtId: court.id,
              startsAt, endsAt, turnoverBufferMinutes: 0, tz: TZ,
              durationMinutes: (r.end - r.start) * 60, players: 1,
              priceMinor: r.priceMinor, status: "confirmed",
            },
          });
          insertedTotal += r.priceMinor; insertedCount++; rowsOk++;
        } catch (e) {
          rowsSkipped++;
          if (rowsSkipped <= 15) console.log(`    skip (conflict) ${g.league} ${g.dateKey} ${court.code} ${r.start}-${r.end}`);
        }
      }

      if (insertedCount === 0) {
        await prisma.bookingGroup.delete({ where: { id: groupId } });
        emptyRemoved++;
      } else {
        await prisma.bookingGroup.update({ where: { id: groupId }, data: { totalMinor: insertedTotal } });
        groupsCreated++;
      }
    }

    console.log(`\nDONE.`);
    console.log(`  Groups created: ${groupsCreated}  |  already-present (skipped): ${groupsSkipped}  |  emptied-and-removed: ${emptyRemoved}`);
    console.log(`  Rows created:   ${rowsOk}  |  skipped on conflict: ${rowsSkipped}`);

    await prisma.$disconnect();
  } catch (e) {
    await prisma.$disconnect();
    console.error("\nERROR:", e.message);
    process.exit(1);
  }
}

main();
