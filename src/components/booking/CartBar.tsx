"use client";

export interface CartItem {
  key: string;
  courtId: string;
  courtName: string;
  start: string;
  end: string;
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
}

/**
 * Sticky bottom cart bar — matches v2's #cartBar (JS.html renderCartBar()).
 * Holds any number of items across multiple courts and/or times; each is
 * individually removable.
 */
export function CartBar({
  items,
  totalHoursLabel,
  totalText,
  onRemove,
  onClearAll,
  onContinue,
}: {
  items: CartItem[];
  totalHoursLabel: string;
  totalText: string;
  onRemove: (key: string) => void;
  onClearAll: () => void;
  onContinue: () => void;
}) {
  return (
    <div className={`cart-bar ${items.length ? "visible" : ""}`}>
      <div className="cart-bar__items">
        {items.map((item) => (
          <span className="cart-chip" key={item.key}>
            {item.courtName} · {formatTime(item.start)}–{formatTime(item.end)}
            <button type="button" onClick={() => onRemove(item.key)} aria-label={`Remove ${item.courtName} ${item.start}`}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="cart-bar__row">
        <span className="mono dim">{totalHoursLabel}</span>
        <div className="cart-bar__total">Total: {totalText}</div>
        <button type="button" className="btn secondary" onClick={onClearAll} disabled={!items.length}>
          Clear Selection
        </button>
        <button className="btn" onClick={onContinue} disabled={!items.length}>
          Continue
        </button>
      </div>
    </div>
  );
}
