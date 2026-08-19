"use client";

import { Fragment, useEffect, useState } from "react";
import type { AvailabilityGrid, GridCourt } from "@/lib/booking/availability";

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
  const [imageCourt, setImageCourt] = useState<GridCourt | null>(null);

  useEffect(() => {
    if (!imageCourt) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setImageCourt(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [imageCourt]);

  return (
    <div className="grid-wrap" aria-busy={isPending}>
      <div className="court-grid" style={{ ["--court-count" as string]: grid.courts.length || 1 }}>
        <div className="head" />
        {grid.courts.map((c) => (
          <div
            className="head"
            key={c.id}
            onClick={() => c.imageUrl && setImageCourt(c)}
            title={c.imageUrl ? "Tap to view court photo" : undefined}
            style={c.headerColor ? { color: c.headerColor } : undefined}
          >
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

      {imageCourt && (
        <div className="modal-backdrop" onClick={() => setImageCourt(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <span className="close" onClick={() => setImageCourt(null)}>
              [ ESC ]
            </span>
            <h3>{imageCourt.name}</h3>
            {imageCourt.description && (
              <p className="dim mono" style={{ fontSize: 12, marginTop: -8 }}>
                {imageCourt.description}
              </p>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageCourt.imageUrl ?? undefined} alt={imageCourt.name} style={{ width: "100%", borderRadius: "var(--radius)", display: "block" }} />
          </div>
        </div>
      )}
    </div>
  );
}
