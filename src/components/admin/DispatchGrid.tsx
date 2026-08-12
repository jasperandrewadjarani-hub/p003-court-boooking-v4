"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { fetchDispatchGridAction } from "@/app/admin/actions";
import { createFrontdeskBookingAction } from "@/lib/admin/frontdesk";
import { previewCartTotalAction } from "@/app/actions";
import type { DispatchGridData, DispatchTileState } from "@/lib/admin/dispatchGrid";
import type { MembershipOption } from "@/lib/booking/memberships";

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

interface SelectedSlot {
  key: string;
  courtId: string;
  courtName: string;
  start: string;
  end: string;
}

type Filter = "all" | "paid" | "unpaid" | "vacant";

/** Matches v2's Dispatch Grid — the admin's own HUD-style live schedule.
 * Vacant tiles are clickable and multi-selectable to build a walk-in
 * booking; paid/unpaid/blocked tiles show booking detail on hover. */
export function DispatchGrid({ initialGrid, currency, memberships }: { initialGrid: DispatchGridData; currency: string; memberships: MembershipOption[] }) {
  const [dateKey, setDateKey] = useState(initialGrid.date);
  const [grid, setGrid] = useState(initialGrid);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<SelectedSlot[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function loadDate(key: string) {
    setDateKey(key);
    setSelected([]);
    startTransition(async () => {
      const data = await fetchDispatchGridAction(key);
      setGrid(data);
    });
  }

  function toggleSlot(courtId: string, courtName: string, start: string, end: string) {
    const key = `${courtId}__${start}`;
    setSelected((prev) => (prev.some((s) => s.key === key) ? prev.filter((s) => s.key !== key) : [...prev, { key, courtId, courtName, start, end }]));
  }

  const dateButtons = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  }), []);

  return (
    <div className="panel dispatch-panel">
      <div className="dispatch-header">
        <div>
          <div className="panel__title">Court Dispatch Grid</div>
          <p className="dim mono" style={{ fontSize: 11, margin: 0 }}>
            Live court occupancy, payment status, and availability by slot.
          </p>
        </div>
        <div className="dispatch-controls">
          {(["all", "paid", "unpaid", "vacant"] as Filter[]).map((f) => (
            <button key={f} className={`btn secondary dispatch-filter ${filter === f ? "active" : ""}`} data-filter={f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "vacant" ? "Vacant Only" : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="dispatch-legend">
        <span><i className="dispatch-dot paid" />Paid / Confirmed</span>
        <span><i className="dispatch-dot unpaid" />Reserved / Unpaid</span>
        <span><i className="dispatch-dot vacant" />Vacant</span>
        <span><i className="dispatch-dot blocked" />Blocked</span>
      </div>

      <div className="dispatch-date-row">
        {dateButtons.map((key) => {
          const d = new Date(key + "T00:00:00");
          return (
            <button key={key} className={`dispatch-date-chip ${key === dateKey ? "active" : ""}`} onClick={() => loadDate(key)}>
              <strong>{d.getDate()}</strong>
              <span>{d.toLocaleDateString(undefined, { weekday: "short" })}</span>
            </button>
          );
        })}
      </div>

      <div className="dispatch-grid-wrap" aria-busy={isPending}>
        <div
          className="dispatch-grid"
          style={{ ["--dispatch-courts" as string]: grid.courts.length || 1, ["--dispatch-slots" as string]: grid.courts[0]?.slots.length || 1 }}
        >
          <div className="dispatch-time-head" />
          {grid.courts.map((c) => (
            <div className="dispatch-court-head" key={c.courtId}>
              {c.courtName}
              {c.description && <span>{c.description}</span>}
            </div>
          ))}
          {grid.courts[0]?.slots.map((_, i) => (
            <Fragment key={i}>
              <div className="dispatch-time-cell">
                <span className="dtc-range">
                  {formatTime(grid.courts[0].slots[i].start)}
                  <span className="dtc-dash">–</span>
                  <span className="dtc-end">{formatTime(grid.courts[0].slots[i].end)}</span>
                </span>
              </div>
              {grid.courts.map((court) => {
                const slot = court.slots[i];
                const key = `${court.courtId}__${slot.start}`;
                const isSelected = selected.some((s) => s.key === key);
                const isFilteredOut = filter !== "all" && slot.state !== filter;
                const classes = ["dispatch-tile", slot.state, isSelected ? "selected" : "", isFilteredOut ? "is-filtered-out" : ""].filter(Boolean).join(" ");
                return (
                  <button
                    key={court.courtId}
                    className={classes}
                    disabled={slot.state !== "vacant"}
                    onClick={() => slot.state === "vacant" && toggleSlot(court.courtId, court.courtName, slot.start, slot.end)}
                  >
                    {slot.state === "vacant" ? (
                      <span className="tile-status">{isSelected ? "Selected" : "Open"}</span>
                    ) : slot.state === "blocked" ? (
                      <span className="tile-status">Maintenance</span>
                    ) : (
                      <>
                        <div className="tile-primary">{slot.booking?.customerName}</div>
                        <div className="tile-secondary">{slot.booking?.reference}</div>
                        <span className="tile-status">{slot.booking?.paymentStatus}</span>
                        <div className="dispatch-popover">
                          <strong>{slot.booking?.customerName}</strong>
                          <span>{slot.booking?.reference}</span>
                          <span>
                            {currency} {((slot.booking?.totalMinor ?? 0) / 100).toFixed(2)}
                          </span>
                          <span>{slot.booking?.status}</span>
                        </div>
                      </>
                    )}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {selected.length > 0 && (
        <div className="dispatch-selection-bar dispatch-selection-dock">
          <div>
            <div className="mono dim" style={{ fontSize: 10 }}>
              Selected frontdesk slots
            </div>
            <div className="dispatch-selected-slots">
              {selected.map((s) => (
                <span className="dispatch-chip" key={s.key}>
                  {s.courtName} {formatTime(s.start)}
                  <button onClick={() => toggleSlot(s.courtId, s.courtName, s.start, s.end)}>✕</button>
                </span>
              ))}
            </div>
          </div>
          <div className="dispatch-selection-actions">
            <button className="btn" onClick={() => setModalOpen(true)}>
              Create Booking
            </button>
            <button className="btn secondary" onClick={() => setSelected([])}>
              Clear
            </button>
          </div>
        </div>
      )}

      {modalOpen && (
        <FrontdeskBookingModal
          items={selected}
          dateKey={dateKey}
          currency={currency}
          memberships={memberships}
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            setSelected([]);
            loadDate(dateKey);
          }}
        />
      )}
    </div>
  );
}

function FrontdeskBookingModal({
  items,
  dateKey,
  currency,
  memberships,
  onClose,
  onCreated,
}: {
  items: SelectedSlot[];
  dateKey: string;
  currency: string;
  memberships: MembershipOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", email: "", players: 2, notes: "", membershipType: "" });
  const [preview, setPreview] = useState({ totalMinor: 0 });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    previewCartTotalAction(dateKey, items.map((i) => ({ courtId: i.courtId, startTime: i.start, endTime: i.end })), form.membershipType || undefined).then(
      setPreview
    );
  }, [items, dateKey, form.membershipType]);

  async function submit() {
    setError(null);
    if (!form.firstName && !form.lastName) {
      setError("Enter the customer name.");
      return;
    }
    if (!form.phone) {
      setError("Enter the customer phone number.");
      return;
    }
    setPending(true);
    try {
      const res = await createFrontdeskBookingAction({
        items: items.map((i) => ({ courtId: i.courtId, startTime: i.start, endTime: i.end })),
        dateKey,
        players: form.players,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        email: form.email,
        notes: form.notes,
        membershipType: form.membershipType || undefined,
      });
      if (res.ok) {
        onCreated();
      } else {
        setError(res.error);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <span className="close" onClick={onClose}>
          [ ESC ]
        </span>
        <h3>Frontdesk Booking</h3>
        <div>
          {items.map((item) => (
            <div className="frontdesk-item" key={item.key}>
              <strong>{item.courtName}</strong>
              <span>
                {formatTime(item.start)}–{formatTime(item.end)}
              </span>
            </div>
          ))}
        </div>
        <div className="total-line" style={{ marginTop: 12 }}>
          <span>Estimated Total</span>
          <span>
            {currency} {(preview.totalMinor / 100).toFixed(2)}
          </span>
        </div>
        <div className="inline-form" style={{ marginTop: 14 }}>
          <div>
            <label>First Name</label>
            <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </div>
          <div>
            <label>Last Name</label>
            <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
          <div>
            <label>Phone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label>Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label>Players</label>
            <input type="number" min={1} value={form.players} onChange={(e) => setForm({ ...form, players: Number(e.target.value) })} />
          </div>
          <div>
            <label>Membership</label>
            <select value={form.membershipType} onChange={(e) => setForm({ ...form, membershipType: e.target.value })}>
              <option value="">No Membership</option>
              {memberships.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} (−{m.discountPercent}%)
                </option>
              ))}
            </select>
          </div>
        </div>
        <label>Notes</label>
        <input placeholder="Walk-in / frontdesk notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <p className="dim mono" style={{ fontSize: 11 }}>
          This admin form bypasses customer OTP and creates the booking directly.
        </p>
        {error && <div className="field-warning">{error}</div>}
        <button className="btn block" style={{ marginTop: 18 }} onClick={submit} disabled={pending}>
          {pending ? "Creating…" : "Create Booking"}
        </button>
      </div>
    </div>
  );
}
