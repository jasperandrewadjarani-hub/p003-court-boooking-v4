// Parses the downloaded Zamboanga workbook (xlsx) and dumps structure + config
// + all bookings to JSON files in scratchpad, printing a compact summary.
// Run: node scripts/parse-workbook.mjs <xlsxPath> <outDir>
import ExcelJS from "exceljs";
import { writeFileSync } from "fs";

const xlsxPath = process.argv[2];
const outDir = process.argv[3];

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(xlsxPath);

function cellVal(c) {
  const v = c && c.value;
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.hyperlink) return String(v.hyperlink);
    if (v instanceof Date) return v.toISOString();
    if (v.richText) return v.richText.map((r) => r.text).join("");
    return JSON.stringify(v);
  }
  return String(v);
}

function sheetRows(ws) {
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const arr = [];
    row.eachCell({ includeEmpty: true }, (c) => arr.push(cellVal(c)));
    // trim trailing empties
    while (arr.length && arr[arr.length - 1] === "") arr.pop();
    rows.push(arr);
  });
  return rows;
}

const summary = [];
const tabs = {};
for (const ws of wb.worksheets) {
  const rows = sheetRows(ws);
  tabs[ws.name] = rows;
  summary.push({ name: ws.name, rows: rows.length, header: rows[0] ? rows[0].slice(0, 30) : [] });
}

console.log("=== TABS ===");
for (const s of summary) {
  console.log(`\n• ${s.name}  (${s.rows} rows)`);
  console.log(`   header: ${JSON.stringify(s.header)}`);
}

// Write everything (non-booking config tabs fully; bookings separately)
const bookingTabName = wb.worksheets.find((w) => /^booking/i.test(w.name))?.name;
const configTabs = {};
for (const [name, rows] of Object.entries(tabs)) {
  if (name === bookingTabName) continue;
  configTabs[name] = rows;
}
writeFileSync(`${outDir}/workbook_config.json`, JSON.stringify(configTabs, null, 1));
if (bookingTabName) {
  writeFileSync(`${outDir}/workbook_bookings.json`, JSON.stringify(tabs[bookingTabName]));
  const b = tabs[bookingTabName];
  console.log(`\n=== BOOKINGS tab "${bookingTabName}" ===`);
  console.log(`data rows (excl header): ${b.length - 1}`);
  console.log(`columns: ${JSON.stringify(b[0])}`);
}
console.log(`\nwrote ${outDir}/workbook_config.json and workbook_bookings.json`);
