"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { fetchDispatchGridAction, blockSlotsAction, unblockSlotsAction } from "@/app/admin/actions";
import { createFrontdeskBookingAction } from "@/lib/admin/frontdesk";
import { previewCartTotalAction } from "@/app/actions";
import type { DispatchGridData } from "@/lib/admin/dispatchGrid";
import type { MembershipOption } from "@/lib/booking/memberships";

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
}

// v3b tile clock ("12:00 AM") + date label ("17-Aug") formats.
function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
function formatDateLabel(key: string): string {
  const d = new Date(key + "T00:00:00");
  return `${d.getDate()}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}`;
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function todayKey(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

interface SelectedSlot {
  key: string;
  courtId: string;
  courtName: string;
  start: string;
  end: string;
  kind: "vacant" | "blocked";
  blockId?: string;
}

type Filter = "all" | "paid" | "unpaid" | "vacant";

const PAYMENT_METHODS = ["cash", "gcash", "maya", "credit_card", "bank_transfer"] as const;

/** v3b Dispatch Grid — admin live schedule. Vacant tiles are multi-selectable
 * to build a walk-in booking OR to block; blocked tiles are selectable to
 * unblock; occupied tiles show booking detail + a payment medal. */
export function DispatchGrid({ initialGrid, currency, memberships }: { initialGrid: DispatchGridData; currency: string; memberships: MembershipOption[] }) {
  const [dateKey, setDateKey] = useState(initialGrid.date);
  const [grid, setGrid] = useState(initialGrid);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<SelectedSlot[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [cropCustomerHours, setCropCustomerHours] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function loadDate(key: string) {
    setDateKey(key);
    setSelected([]);
    startTransition(async () => {
      const data = await fetchDispatchGridAction(key);
      setGrid(data);
    });
  }

  function refresh() {
    startTransition(async () => setGrid(await fetchDispatchGridAction(dateKey)));
  }

  // Selecting a tile of a different kind than the current selection resets it —
  // you can't mix vacant (book/block) and blocked (unblock) in one action.
  function toggleSlot(s: Omit<SelectedSlot, "key">) {
    const key = `${s.courtId}__${s.start}`;
    setActionError(null);
    setSelected((prev) => {
      if (prev.some((p) => p.key === key)) return prev.filter((p) => p.key !== key);
      if (prev.length && prev[0].kind !== s.kind) return [{ ...s, key }];
      return [...prev, { ...s, key }];
    });
  }

  const selectionKind = selected.length ? selected[0].kind : null;

  function doBlock() {
    setActionError(null);
    startTransition(async () => {
      const res = await blockSlotsAction(dateKey, selected.map((s) => ({ courtId: s.courtId, startTime: s.start, endTime: s.end })));
      if (res.ok) {
        setSelected([]);
        refresh();
      } else setActionError(res.error);
    });
  }

  function doUnblock() {
    setActionError(null);
    startTransition(async () => {
      const ids = [...new Set(selected.map((s) => s.blockId).filter(Boolean) as string[])];
      const res = await unblockSlotsAction(ids);
      if (res.ok) {
        setSelected([]);
        refresh();
      } else setActionError(res.error);
    });
  }

  // v3b shows up to 21 days in the scrollable strip.
  const dateButtons = useMemo(() => Array.from({ length: 21 }, (_, i) => todayKey(i)), []);

  const rowCount = grid.courts[0]?.slots.length ?? 0;
  // Customer-hours crop: hide rows whose slot start is outside the customer
  // window — purely client-side, no refetch (v3b behavior).
  const visibleRows = useMemo(() => {
    const idx = Array.from({ length: rowCount }, (_, i) => i);
    if (!cropCustomerHours) return idx;
    const { startMin, endMin } = grid.customerWindow;
    return idx.filter((i) => {
      const s = grid.courts[0]?.slots[i];
      if (!s) return false;
      const m = toMin(s.start);
      return m >= startMin && m < endMin;
    });
  }, [rowCount, cropCustomerHours, grid]);

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
          <label className="mono dim" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 11, whiteSpace: "nowrap" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={cropCustomerHours} onChange={(e) => setCropCustomerHours(e.target.checked)} />
            Customer hours
          </label>
          {(["all", "paid", "unpaid", "vacant"] as Filter[]).map((f) => (
            <button key={f} className={`btn secondary dispatch-filter ${filter === f ? "active" : ""}`} data-filter={f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "vacant" ? "Vacant Only" : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="dispatch-legend">
        <span><i className="dispatch-dot paid" />Paid / Confirmed</span>
        <span><i className="dispatch-dot unpaid" style={{ background: "#FFCA3A" }} />Awaiting Verification</span>
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
              <span>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]}</span>
            </button>
          );
        })}
      </div>

      <div className="dispatch-grid-wrap" aria-busy={isPending}>
        <div
          className="dispatch-grid"
          style={{ ["--dispatch-courts" as string]: grid.courts.length || 1, ["--dispatch-slots" as string]: visibleRows.length || 1 }}
        >
          <div className="dispatch-time-head"><span>Time</span></div>
          {grid.courts.map((c) => (
            <div className="dispatch-court-head" key={c.courtId}>
              {c.courtName}
              {c.description && <span>{c.description}</span>}
            </div>
          ))}
          {visibleRows.map((i) => (
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
                const awaiting = slot.booking?.paymentStatus === "awaiting_verification";
                const isFilteredOut = filter !== "all" && slot.state !== filter;
                const statusClass = slot.booking ? `booking-status-${String(slot.booking.status || "reserved").toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
                const paymentKebab = String(slot.booking?.paymentStatus || "unpaid").toLowerCase().replace(/[^a-z0-9]+/g, "-");
                const classes = ["dispatch-tile", slot.state, statusClass, isSelected ? "selected" : "", isFilteredOut ? "is-filtered-out" : ""].filter(Boolean).join(" ");
                const selectable = slot.state === "vacant" || slot.state === "blocked";
                return (
                  <button
                    key={court.courtId}
                    className={classes}
                    disabled={!selectable}
                    onClick={() =>
                      selectable &&
                      toggleSlot({
                        courtId: court.courtId,
                        courtName: court.courtName,
                        start: slot.start,
                        end: slot.end,
                        kind: slot.state === "blocked" ? "blocked" : "vacant",
                        blockId: slot.block?.id,
                      })
                    }
                  >
                    {slot.state === "vacant" ? (
                      <>
                        <span className="tile-open-line">
                          <strong>{isSelected ? "Selected Slot" : "Open Slot"}</strong>
                          <em>{isSelected ? "Selected" : "Book →"}</em>
                        </span>
                        <span className="tile-open-date">{formatDateLabel(dateKey)}</span>
                        <span className="tile-open-time">{formatClock(slot.start)} - {formatClock(slot.end)}</span>
                      </>
                    ) : slot.state === "blocked" ? (
                      <>
                        <span className="tile-open-line">
                          <strong>{isSelected ? "Selected Block" : "Blocked"}</strong>
                          <em>{slot.block?.id ? "Unblock →" : ""}</em>
                        </span>
                        <span className="tile-open-date">{formatDateLabel(dateKey)}</span>
                        <span className="tile-open-time">{formatClock(slot.start)} - {formatClock(slot.end)}</span>
                      </>
                    ) : slot.state === "maintenance" ? (
                      <>
                        <span className="tile-open-line"><strong>Maintenance</strong></span>
                        <span className="tile-open-time">{formatClock(slot.start)} - {formatClock(slot.end)}</span>
                      </>
                    ) : (
                      <>
                        <div className="tile-primary">{slot.booking?.customerName}</div>
                        <div className="tile-booking-summary">{formatClock(slot.start)} - {formatClock(slot.end)}</div>
                        <div className="tile-financial-row">
                          <span className="tile-financial">
                            {currency} {((slot.booking?.totalMinor ?? 0) / 100).toFixed(2)} · {slot.booking?.status}
                          </span>
                          <span className={`tile-payment-medal payment-${paymentKebab}`}>
                            {awaiting ? "Awaiting" : slot.booking?.paymentStatus}
                          </span>
                        </div>
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

      {actionError && <div className="field-warning" style={{ marginTop: 8 }}>{actionError}</div>}

      {selected.length > 0 && (
        <div className="dispatch-selection-bar dispatch-selection-dock">
          <div>
            <div className="mono dim" style={{ fontSize: 10 }}>
              {selectionKind === "blocked" ? "Selected blocked slots" : "Selected frontdesk slots"}
            </div>
            <div className="dispatch-selected-slots">
              {selected.map((s) => (
                <span className="dispatch-chip" key={s.key}>
                  {s.courtName} {formatTime(s.start)}
                  <button onClick={() => toggleSlot(s)}>✕</button>
                </span>
              ))}
            </div>
          </div>
          <div className="dispatch-selection-actions">
            {selectionKind === "blocked" ? (
              <button className="btn" onClick={doUnblock} disabled={isPending}>
                Unblock
              </button>
            ) : (
              <>
                <button className="btn" onClick={() => setModalOpen(true)}>
                  Create Booking
                </button>
                <button className="btn secondary" onClick={doBlock} disabled={isPending}>
                  Block Time Slots
                </button>
              </>
            )}
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
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", email: "", notes: "", membershipType: "", discountCode: "", amountPaid: "0", paymentMethod: "cash" as (typeof PAYMENT_METHODS)[number] });
  const [preview, setPreview] = useState<{ totalMinor: number; discountMinor: number; discountError?: string }>({ totalMinor: 0, discountMinor: 0 });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const h = setTimeout(() => {
      previewCartTotalAction(
        dateKey,
        items.map((i) => ({ courtId: i.courtId, startTime: i.start, endTime: i.end })),
        form.membershipType || undefined,
        form.discountCode.trim() || undefined
      ).then(setPreview);
    }, 250);
    return () => clearTimeout(h);
  }, [items, dateKey, form.membershipType, form.discountCode]);

  async function submit() {
    setError(null);
    if (!form.firstName && !form.lastName) return setError("Enter the customer name.");
    if (!form.phone) return setError("Enter the customer phone number.");
    setPending(true);
    try {
      const res = await createFrontdeskBookingAction({
        items: items.map((i) => ({ courtId: i.courtId, startTime: i.start, endTime: i.end })),
        dateKey,
        players: 1,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        email: form.email,
        notes: form.notes,
        membershipType: form.membershipType || undefined,
        discountCode: form.discountCode.trim() || undefined,
        amountPaidMinor: Math.round(Number(form.amountPaid) * 100) || 0,
        paymentMethod: form.paymentMethod,
      });
      if (res.ok) onCreated();
      else setError(res.error);
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
        {preview.discountError && <div className="field-warning">{preview.discountError}</div>}
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
            <label>Membership</label>
            <select value={form.membershipType} onChange={(e) => setForm({ ...form, membershipType: e.target.value })}>
              <option value="">None</option>
              {memberships.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} (−{m.discountPercent}%)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Discount Code</label>
            <input value={form.discountCode} onChange={(e) => setForm({ ...form, discountCode: e.target.value })} placeholder="Optional" />
          </div>
          <div>
            <label>Amount Paid</label>
            <input type="number" min={0} value={form.amountPaid} onChange={(e) => setForm({ ...form, amountPaid: e.target.value })} />
          </div>
          <div>
            <label>Payment Method</label>
            <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value as (typeof PAYMENT_METHODS)[number] })}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
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
