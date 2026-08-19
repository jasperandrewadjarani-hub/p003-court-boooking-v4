"use client";

import { Fragment } from "react";
import type { AvailabilityGrid } from "@/lib/booking/availability";

export function slotKey(courtId: string, start: string): string {
  return `${courtId}__${start}`;
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
}

/**
 * The HUD court grid — a CSS-grid div structure (not a <table>) matching
 * v2's Index.html/JS.html renderGrid(), with sticky headers on both axes.
 * Click-to-toggle any available slot into the cart; a slot already booked
 * or under maintenance is never clickable. `key={dateKey}` on the wrapper
 * (set by the caller) restarts the CSS scanline-sweep animation on every
 * date change, matching v2's "sweeps once on load/refresh."
 */
export function CourtGrid({
  grid,
  selectedKeys,
  highlightKeys,
  onToggleSlot,
  isPending,
}: {
  grid: AvailabilityGrid;
  selectedKeys: Set<string>;
  /** Slots to briefly spark after a booking just succeeded — see BookingPage's dismissToGrid(). */
  highlightKeys?: Set<string>;
  onToggleSlot: (courtId: string, courtName: string, start: string, end: string) => void;
  isPending: boolean;
}) {
  return (
    <div className="grid-wrap" aria-busy={isPending}>
      <div className="court-grid" style={{ ["--court-count" as string]: grid.courts.length || 1 }}>
        <div className="head" />
        {grid.courts.map((c) => (
          <div className="head" key={c.id}>
            <strong>{c.name}</strong>
            <span>{c.description ?? (c.indoor ? "Indoor" : "Outdoor")}</span>
          </div>
        ))}
        {grid.courts[0]?.slots.map((_, i) => (
          <Fragment key={i}>
            <div className="time-label">
              <span className="tl-range">
                <span className="tl-start">{formatTime(grid.courts[0].slots[i].start)}</span>
                <span className="tl-dash">-</span>
                <span className="tl-end">{formatTime(grid.courts[0].slots[i].end)}</span>
              </span>
            </div>
            {grid.courts.map((court) => {
              const slot = court.slots[i];
              const isSelected = selectedKeys.has(slotKey(court.id, slot.start));
              const isJustBooked = !!highlightKeys?.has(slotKey(court.id, slot.start));
              const clickable = slot.status === "available";
              const classes = ["slot", slot.status, isSelected ? "selected" : "", isJustBooked ? "just-booked" : ""].filter(Boolean).join(" ");
              const label = isSelected
                ? "Selected"
                : slot.status === "available"
                  ? "Open"
                  : slot.status === "booked"
                    ? "Booked"
                    : slot.status === "blocked"
                      ? "Blocked"
                      : "Maint.";
              return (
                <div
                  key={court.id}
                  className={classes}
                  onClick={() => clickable && onToggleSlot(court.id, court.name, slot.start, slot.end)}
                  role={clickable ? "button" : undefined}
                >
                  <span className="slot-label">{label}</span>
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
