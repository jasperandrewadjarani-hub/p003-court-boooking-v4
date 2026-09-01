// Shared display helpers (pure — safe in both server and client components).

const LABEL_SPECIAL: Record<string, string> = {
  gcash: "GCash",
  maya: "Maya",
  gotyme: "GoTyme",
  credit_card: "Credit Card",
  bank_transfer: "Bank Transfer",
  awaiting_verification: "Awaiting Verification",
  no_show: "No Show",
  checked_in: "Checked In",
  web_app: "Web App",
  walk_in: "Walk-In",
  fixed_php: "Fixed PHP",
  fixed_php_per_slot: "PHP per Slot",
};

/** Turns an enum/machine value into a human label with proper capitalization:
 *  "cash" -> "Cash", "confirmed" -> "Confirmed", "gcash" -> "GCash",
 *  "awaiting_verification" -> "Awaiting Verification". */
export function labelize(value: string | null | undefined): string {
  if (!value) return "";
  const key = String(value).trim().toLowerCase();
  if (LABEL_SPECIAL[key]) return LABEL_SPECIAL[key];
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Money in minor units → "1,234.56" (thousands separators, 2 decimals).
 *  Callers prepend the currency symbol. */
export function formatMoney(minor: number): string {
  return ((minor ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface SlotItem {
  courtName: string;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  priceMinor: number;
}

/** Compiles consecutive same-court slots into one range row (v3b behaviour):
 *  Court 1 7-8pm + 8-9pm + 9-10pm -> Court 1 7-10pm. Prices are summed. */
export function compileSlots<T extends SlotItem>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.courtName.localeCompare(b.courtName) || a.start.localeCompare(b.start));
  const out: T[] = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && last.courtName === it.courtName && last.end === it.start) {
      last.end = it.end;
      last.priceMinor += it.priceMinor;
    } else {
      out.push({ ...it });
    }
  }
  return out;
}
