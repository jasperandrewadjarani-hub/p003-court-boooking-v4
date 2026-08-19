// Importer for the "2026" monitoring grid in the client's live tracking workbook
// ("DINK AND DUNK google sheets.xlsx"). Unlike scripts/import-zamboanga.mjs (which
// read a normalized Bookings list from a different workbook), THIS sheet is a wide
// occupancy grid: one row per (date, hour) and one column-pair per court holding a
// booker name + amount. We reconstruct discrete v4 bookings from it:
//
//   • Every non-empty court cell = (date, court, hour, bookerName, amount).
//   • Consecutive hours on the same court/date for the same booker are MERGED into
//     one Booking row spanning the full window (matches how v4 renders and how the
//     Bookings tab lists a reservation — e.g. "Sheeza 6:00 PM - 11:00 PM").
//   • All of a booker's court-blocks on the same date become one BookingGroup
//     (one party reserving several courts/times that day).
//   • "Maintenance" cells are court blocks, not customer bookings -> BlockedSlot.
//   • Payment annotations embedded in names ("... paid", "paid gcash", "paid cash")
//     set the group's payment status + method; the annotation is stripped from the
//     customer's display name and used to fold "Kate Prado" / "Kate prado paid gcash"
//     into one customer.
//
// Alignment with v4 architecture (all mirrored from create.ts / import-zamboanga.mjs):
//   • Slot times are stored as "floating" wall-clock-in-UTC ( `${date}T${HH}:00Z` ),
//     read back with getUTCHours() everywhere — so NO +08:00 offset.
//   • turnoverBufferMinutes = 0 (historical import; a non-zero buffer would make
//     back-to-back bookings by DIFFERENT parties on one court trip the exclusion
//     constraint), tz "Asia/Manila".
//   • bookings.local_date and block_range are filled by the DB BEFORE-INSERT trigger
//     — never written here.
//   • The GiST exclusion constraint can never fire: each (court, date, hour) grid
//     cell holds exactly one booker, so no two groups share a court-hour.
//   • Money imported verbatim from the sheet (per-cell amounts summed), never
//     recomputed (notes.md #147).
//
// Connects like prisma/seed.ts / import-zamboanga.mjs (DIRECT_URL, migration role).
// Idempotent: a --commit run RESETS the tenant's transactional booking/customer data
// (payments, receipts, booking groups+rows, blocked slots, customers + their users)
// FIRST, then re-imports — tenant config, courts, settings, staff/admin are untouched.
//
// Usage:
//   node scripts/import-2026-grid.mjs                 # dry-run: parse + report, ZERO writes
//   node scripts/import-2026-grid.mjs --commit        # perform the reset + import (destructive)

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import ExcelJS from "exceljs";
import { randomUUID } from "crypto";

const FILE = "D:/claude_/P003_CourtBookingSystem/v4/dnd_assets/DINK AND DUNK google sheets.xlsx";
const SHEET = "2026";
const YEAR = 2026;
const SLUG = "dink-and-dunk";
const TZ = "Asia/Manila";
const COMMIT = process.argv.includes("--commit");
const CHUNK = 1000;

// 2026-tab court columns -> v4 court codes. [code, nameCol, amountCol]
const COURT_COLS = [
  ["DND-C1", 6, 7], ["DND-C2", 9, 10], ["DND-C3", 12, 13],
  ["DND-C4", 15, 16], ["DND-C5", 18, 19], ["DND-C6", 21, 22],
  ["DND-CA", 25, 26], ["DND-CB", 28, 29], ["DND-CC", 31, 32],
  ["DND-CD", 34, 35], ["DND-CE", 37, 38],
];
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

function cellVal(cell) {
  let v = cell.value;
  if (v && typeof v === "object") {
    if (v.result !== undefined) v = v.result;
    else if (v.text !== undefined) v = v.text;
    else if (v.richText) v = v.richText.map((t) => t.text).join("");
  }
  return v;
}
const pad2 = (n) => String(n).padStart(2, "0");

// "Kate prado paid gcash" -> { name:"Kate prado", paid:true, method:"gcash" }
function parseName(raw) {
  const s = String(raw).trim();
  const paid = /\bpaid\b/i.test(s);
  let method = null;
  if (/\bgcash\b/i.test(s)) method = "gcash";
  else if (/\bmaya\b/i.test(s)) method = "maya";
  else if (/\bbank\b/i.test(s)) method = "bank_transfer";
  else if (/\bcash\b/i.test(s)) method = "cash";
  // Strip trailing payment annotations for the display/customer name.
  const name = s
    .replace(/[\s\-\/]*\bpaid\b(\s+(g-?cash|gcash|maya|cash|bank\s*transfer))?\s*$/i, "")
    .replace(/[\s\-\/]+$/,"")
    .trim() || s;
  return { name, paid, method };
}
const isMaintenance = (name) => /^\s*maintenance\s*$/i.test(name);
const normKey = (name) => name.toLowerCase().replace(/\s+/g, " ").trim();
const PHP = (v) => Math.round((Number(String(v ?? "").replace(/[, ₱]/g, "")) || 0) * 100);

// ---------------------------------------------------------------- parse the grid
function parseGrid(ws) {
  // Raw occupied cells across the whole sheet.
  const cells = []; // {dateKey, court, hour, name, key, paid, method, amountMinor, maint}
  let scanned = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const monthName = String(cellVal(row.getCell(1)) ?? "").trim().toLowerCase();
    const day = Number(cellVal(row.getCell(2)));
    const tStart = cellVal(row.getCell(4));
    const month = MONTHS[monthName];
    if (!month || !day || !(tStart instanceof Date)) continue;
    const hour = tStart.getUTCHours();
    const dateKey = `${YEAR}-${pad2(month)}-${pad2(day)}`;
    scanned++;
    for (const [court, nameCol, amtCol] of COURT_COLS) {
      const raw = cellVal(row.getCell(nameCol));
      if (raw === null || raw === undefined || String(raw).trim() === "") continue;
      const { name, paid, method } = parseName(raw);
      const maint = isMaintenance(name);
      cells.push({
        dateKey, court, hour,
        name, key: normKey(name), paid, method,
        amountMinor: PHP(cellVal(row.getCell(amtCol))),
        maint,
      });
    }
  }
  return { cells, scannedRows: scanned };
}

// Merge consecutive-hour cells (same date+court+bookerKey) into blocks.
function mergeBlocks(cells) {
  // index by date|court|key -> sorted hours
  const byLine = new Map();
  for (const c of cells) {
    const k = `${c.dateKey}|${c.court}|${c.key}`;
    if (!byLine.has(k)) byLine.set(k, []);
    byLine.get(k).push(c);
  }
  const blocks = []; // {dateKey, court, key, name, startHour, endHour, amountMinor, paid, method, maint}
  for (const group of byLine.values()) {
    group.sort((a, b) => a.hour - b.hour);
    let cur = null;
    for (const c of group) {
      if (cur && c.hour === cur.endHour) {
        cur.endHour = c.hour + 1;
        cur.amountMinor += c.amountMinor;
        cur.paid = cur.paid || c.paid;
        if (!cur.method && c.method) cur.method = c.method;
      } else {
        if (cur) blocks.push(cur);
        cur = { dateKey: c.dateKey, court: c.court, key: c.key, name: c.name, startHour: c.hour, endHour: c.hour + 1, amountMinor: c.amountMinor, paid: c.paid, method: c.method, maint: c.maint };
      }
    }
    if (cur) blocks.push(cur);
  }
  return blocks;
}

async function main() {
  console.log(`\n=== Import 2026 grid (${COMMIT ? "COMMIT" : "DRY-RUN"}) ===`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) throw new Error(`sheet "${SHEET}" not found`);

  const { cells, scannedRows } = parseGrid(ws);
  const blocks = mergeBlocks(cells);
  const bookingBlocks = blocks.filter((b) => !b.maint);
  const maintBlocks = blocks.filter((b) => b.maint);

  // Customers = distinct booker keys among real bookings (not maintenance).
  const custKeys = new Map(); // key -> displayName (first seen)
  for (const b of bookingBlocks) if (!custKeys.has(b.key)) custKeys.set(b.key, b.name);

  // Groups = (date, bookerKey) -> its blocks.
  const groupMap = new Map();
  for (const b of bookingBlocks) {
    const gk = `${b.dateKey}|${b.key}`;
    if (!groupMap.has(gk)) groupMap.set(gk, []);
    groupMap.get(gk).push(b);
  }

  const totalRevenueMinor = bookingBlocks.reduce((s, b) => s + b.amountMinor, 0);
  const paidBlocks = bookingBlocks.filter((b) => b.paid).length;

  console.log(`Scanned dated rows:     ${scannedRows}`);
  console.log(`Occupied cells:         ${cells.length}`);
  console.log(`  booking cells:        ${cells.filter((c) => !c.maint).length}`);
  console.log(`  maintenance cells:    ${cells.filter((c) => c.maint).length}`);
  console.log(`Merged booking rows:    ${bookingBlocks.length}  (paid-flagged: ${paidBlocks})`);
  console.log(`Merged maintenance:     ${maintBlocks.length}`);
  console.log(`Distinct customers:     ${custKeys.size}`);
  console.log(`Booking groups:         ${groupMap.size}`);
  console.log(`Total sheet revenue:    PHP ${(totalRevenueMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  const dates = [...new Set(bookingBlocks.map((b) => b.dateKey))].sort();
  console.log(`Date span:              ${dates[0]} .. ${dates[dates.length - 1]}  (${dates.length} distinct days)`);

  if (!COMMIT) {
    console.log("\nDry-run only — no DB connection, no data written. Re-run with --commit to import.");
    return;
  }

  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
  const prisma = new PrismaClient({ adapter });
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
    if (!tenant) throw new Error(`tenant ${SLUG} not found`);
    const tid = tenant.id;
    const courts = await prisma.court.findMany({ where: { tenantId: tid } });
    const courtByCode = Object.fromEntries(courts.map((c) => [c.code, c.id]));
    const missing = COURT_COLS.map(([code]) => code).filter((code) => !courtByCode[code]);
    if (missing.length) throw new Error(`courts missing in tenant: ${missing.join(", ")}`);
    console.log(`Tenant: ${tenant.name} (${tid}) — ${courts.length} courts matched`);

    // ---------------- RESET transactional data (preserve config/courts/staff) --------
    await prisma.payment.deleteMany({ where: { tenantId: tid } });
    await prisma.receipt.deleteMany({ where: { tenantId: tid } });
    await prisma.bookingGroup.deleteMany({ where: { tenantId: tid } });
    await prisma.blockedSlot.deleteMany({ where: { tenantId: tid } });
    await prisma.customer.deleteMany({ where: { tenantId: tid } });
    await prisma.user.deleteMany({ where: { tenantId: tid, kind: "customer" } });
    console.log("Reset: cleared payments, receipts, booking groups+rows, blocked slots, customers.");

    // ---------------- Customers (+ users) via bulk createMany with pre-gen IDs -------
    const custDbId = new Map(); // key -> customerId
    const userRows = [];
    const custRows = [];
    for (const [key, displayName] of custKeys) {
      const userId = randomUUID();
      const customerId = randomUUID();
      custDbId.set(key, customerId);
      const parts = displayName.split(/\s+/);
      userRows.push({ id: userId, tenantId: tid, kind: "customer", email: `grid-${customerId}@imported.dnd`, emailVerifiedAt: new Date() });
      custRows.push({ id: customerId, tenantId: tid, userId, firstName: parts[0] || "Guest", lastName: parts.slice(1).join(" ") || "", registeredAt: new Date() });
    }
    for (let i = 0; i < userRows.length; i += CHUNK) await prisma.user.createMany({ data: userRows.slice(i, i + CHUNK) });
    for (let i = 0; i < custRows.length; i += CHUNK) await prisma.customer.createMany({ data: custRows.slice(i, i + CHUNK) });
    console.log(`Customers created: ${custRows.length}`);

    // ---------------- Booking groups + rows (pre-gen IDs, bulk insert) ----------------
    const groupRows = [];
    const bookingRows = [];
    let seqByDate = new Map();
    for (const [gk, gblocks] of groupMap) {
      const [dateKey, key] = gk.split("|");
      const groupId = randomUUID();
      const seq = (seqByDate.get(dateKey) || 0) + 1;
      seqByDate.set(dateKey, seq);
      const reference = `MIG26-${dateKey.replace(/-/g, "")}-${pad2(seq)}`;
      const totalMinor = gblocks.reduce((s, b) => s + b.amountMinor, 0);
      const paidMinor = gblocks.filter((b) => b.paid).reduce((s, b) => s + b.amountMinor, 0);
      const paymentStatus = totalMinor > 0 && paidMinor >= totalMinor ? "paid" : paidMinor > 0 ? "partial" : "unpaid";
      groupRows.push({
        id: groupId, tenantId: tid, reference, customerId: custDbId.get(key),
        status: "confirmed", paymentStatus, source: "staff",
        totalMinor, amountPaidMinor: paidMinor, discountAmountMinor: 0,
        idempotencyKey: reference, createdAt: new Date(`${dateKey}T08:00:00.000Z`),
      });
      for (const b of gblocks) {
        const startsAt = new Date(`${b.dateKey}T${pad2(b.startHour)}:00:00.000Z`);
        const endsAt = new Date(startsAt.getTime() + (b.endHour - b.startHour) * 3600 * 1000);
        bookingRows.push({
          id: randomUUID(), tenantId: tid, bookingGroupId: groupId, courtId: courtByCode[b.court],
          startsAt, endsAt, turnoverBufferMinutes: 0, tz: TZ,
          durationMinutes: (b.endHour - b.startHour) * 60, players: 1,
          priceMinor: b.amountMinor, status: "confirmed",
        });
      }
    }
    for (let i = 0; i < groupRows.length; i += CHUNK) await prisma.bookingGroup.createMany({ data: groupRows.slice(i, i + CHUNK) });
    console.log(`Booking groups created: ${groupRows.length}`);

    // Bookings: bulk createMany per chunk; on any chunk failure, fall back to per-row.
    let rowsOk = 0, rowsSkipped = 0;
    for (let i = 0; i < bookingRows.length; i += CHUNK) {
      const slice = bookingRows.slice(i, i + CHUNK);
      try {
        await prisma.booking.createMany({ data: slice });
        rowsOk += slice.length;
      } catch {
        for (const row of slice) {
          try { await prisma.booking.create({ data: row }); rowsOk++; }
          catch { rowsSkipped++; }
        }
      }
      if ((i / CHUNK) % 5 === 0) console.log(`  ...bookings ${rowsOk}/${bookingRows.length}`);
    }
    console.log(`Bookings created: ${rowsOk} (skipped on conflict: ${rowsSkipped})`);

    // ---------------- Maintenance -> blocked slots -----------------------------------
    const blockRows = maintBlocks.map((b) => {
      const startsAt = new Date(`${b.dateKey}T${pad2(b.startHour)}:00:00.000Z`);
      const endsAt = new Date(startsAt.getTime() + (b.endHour - b.startHour) * 3600 * 1000);
      return { tenantId: tid, courtId: courtByCode[b.court], localDate: new Date(`${b.dateKey}T00:00:00.000Z`), startsAt, endsAt, reason: "Maintenance", createdAt: new Date(`${b.dateKey}T08:00:00.000Z`) };
    });
    for (let i = 0; i < blockRows.length; i += CHUNK) await prisma.blockedSlot.createMany({ data: blockRows.slice(i, i + CHUNK) });
    console.log(`Blocked (maintenance) slots created: ${blockRows.length}`);

    // ---------------- Summary from DB -------------------------------------------------
    const [g, b, c, blk] = await Promise.all([
      prisma.bookingGroup.count({ where: { tenantId: tid } }),
      prisma.booking.count({ where: { tenantId: tid } }),
      prisma.customer.count({ where: { tenantId: tid } }),
      prisma.blockedSlot.count({ where: { tenantId: tid } }),
    ]);
    console.log(`\n=== FINAL (tenant ${SLUG}) ===\nbooking_groups=${g} bookings=${b} customers=${c} blocked=${blk}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
