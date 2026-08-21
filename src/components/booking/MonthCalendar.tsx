"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; // Sunday-first
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const pad2 = (n: number) => String(n).padStart(2, "0");
const toKey = (y: number, m0: number, d: number) => `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
function parseKey(k: string) {
  const [y, m, d] = k.split("-").map(Number);
  return { y, m0: m - 1, d };
}
function longLabel(k: string) {
  const { y, m0, d } = parseKey(k);
  return `${MONTHS[m0].slice(0, 3)} ${d}, ${y}`;
}

/**
 * Compact custom month calendar — weeks start on SUNDAY (native <input type=date>
 * popups follow the browser locale and can't be forced Sunday-first, hence this).
 * Fully themed and larger-touch-target for mobile.
 */
export function MonthCalendar({
  value,
  min,
  max,
  onSelect,
}: {
  value: string;
  min?: string;
  max?: string;
  onSelect: (dateKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const { y, m0 } = parseKey(value);
    return { y, m0 };
  });
  const wrapRef = useRef<HTMLDivElement>(null);

  // Keep the shown month in sync if the selected date changes elsewhere (chips).
  useEffect(() => {
    const { y, m0 } = parseKey(value);
    setView({ y, m0 });
  }, [value]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cells = useMemo(() => {
    const firstDow = new Date(Date.UTC(view.y, view.m0, 1)).getUTCDay(); // 0=Sun
    const daysInMonth = new Date(Date.UTC(view.y, view.m0 + 1, 0)).getUTCDate();
    const out: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(d);
    return out;
  }, [view]);

  function shiftMonth(delta: number) {
    setView((v) => {
      const m = v.m0 + delta;
      const y = v.y + Math.floor(m / 12);
      const m0 = ((m % 12) + 12) % 12;
      return { y, m0 };
    });
  }

  function pick(d: number) {
    const key = toKey(view.y, view.m0, d);
    if (min && key < min) return;
    if (max && key > max) return;
    onSelect(key);
    setOpen(false);
  }

  const todayKey = (() => {
    const n = new Date();
    return toKey(n.getFullYear(), n.getMonth(), n.getDate());
  })();

  return (
    <div className="mini-cal" ref={wrapRef}>
      <button type="button" className="mini-cal-toggle" onClick={() => setOpen((o) => !o)}>
        📅 {longLabel(value)}
      </button>
      {open && (
        <div className="mini-cal-panel" role="dialog" aria-label="Choose a date">
          <div className="mini-cal-head">
            <button type="button" className="mini-cal-nav" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              ‹
            </button>
            <strong>
              {MONTHS[view.m0]} {view.y}
            </strong>
            <button type="button" className="mini-cal-nav" onClick={() => shiftMonth(1)} aria-label="Next month">
              ›
            </button>
          </div>
          <div className="mini-cal-grid">
            {DOW.map((d) => (
              <div className="mini-cal-dow" key={d}>
                {d}
              </div>
            ))}
            {cells.map((d, i) => {
              if (d === null) return <div key={`b${i}`} className="mini-cal-blank" />;
              const key = toKey(view.y, view.m0, d);
              const disabled = (min && key < min) || (max && key > max);
              const classes = ["mini-cal-day", key === value ? "selected" : "", key === todayKey ? "today" : ""].filter(Boolean).join(" ");
              return (
                <button type="button" key={key} className={classes} disabled={!!disabled} onClick={() => pick(d)}>
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
