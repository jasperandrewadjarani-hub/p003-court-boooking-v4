"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { fetchDispatchGridAction, blockSlotsAction, unblockSlotsAction, getBookingGroupAction } from "@/app/admin/actions";
import { createFrontdeskBookingAction } from "@/lib/admin/frontdesk";
import { previewCartTotalAction } from "@/app/actions";
import type { DispatchGridData, DispatchCourt, DispatchTile } from "@/lib/admin/dispatchGrid";
import type { MembershipOption } from "@/lib/booking/memberships";
import type { AdminBookingGroup } from "@/lib/admin/bookings";
import { BookingOperationsModal } from "@/components/admin/BookingOperationsModal";
import { labelize } from "@/lib/format";

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
function formatDateHeader(key: string): string {
  const d = new Date(key + "T00:00:00");
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  return `${formatDateLabel(key)}-${String(d.getFullYear()).slice(2)} (${wd})`;
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
  // Clicking an occupied block opens the full Booking Operations modal.
  const [opsBooking, setOpsBooking] = useState<AdminBookingGroup | null>(null);

  function openBooking(id: string) {
    startTransition(async () => {
      const b = await getBookingGroupAction(id);
      if (b) setOpsBooking(b);
    });
  }

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

  // Courts limited to the visible rows, so the merge math (below) runs on the
  // exact sequence being rendered. Each court's `slots` is the cropped list.
  const courtsV = useMemo<DispatchCourt[]>(
    () => grid.courts.map((c) => ({ ...c, slots: visibleRows.map((r) => c.slots[r]) })),
    [grid, visibleRows]
  );

  // v3b block-merge helpers: a booking group renders as ONE tile spanning the
  // contiguous rectangle of courts × time-rows it occupies (same booking id +
  // state). rowSpan = vertical run; courtSpan = horizontal run of courts whose
  // vertical run matches. Continuation cells are skipped.
  const key = (s?: DispatchTile) => (s?.booking ? s.booking.id : null);
  function rowSpanAt(slots: DispatchTile[], i: number): number {
    const k = key(slots[i]);
    if (!k) return 1;
    let n = 1;
    for (let j = i + 1; j < slots.length; j++) {
      if (key(slots[j]) !== k || slots[j].state !== slots[i].state) break;
      n++;
    }
    return n;
  }
  const skipRowCont = (slots: DispatchTile[], i: number) => i > 0 && !!key(slots[i]) && key(slots[i]) === key(slots[i - 1]) && slots[i].state === slots[i - 1].state;
  function courtSpanAt(ci: number, i: number, rowSpan: number): number {
    const s = courtsV[ci].slots[i];
    if (!key(s)) return 1;
    let n = 1;
    for (let j = ci + 1; j < courtsV.length; j++) {
      const c = courtsV[j].slots[i];
      if (key(c) !== key(s) || c.state !== s.state || rowSpanAt(courtsV[j].slots, i) !== rowSpan) break;
      n++;
    }
    return n;
  }
  const skipCourtCont = (ci: number, i: number) => {
    if (ci < 1) return false;
    const cur = courtsV[ci].slots[i], prev = courtsV[ci - 1].slots[i];
    if (!key(cur) || key(cur) !== key(prev) || cur.state !== prev.state) return false;
    return rowSpanAt(courtsV[ci].slots, i) === rowSpanAt(courtsV[ci - 1].slots, i);
  };

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
        <span><i className="dispatch-dot awaiting" />Awaiting Verification</span>
        <span><i className="dispatch-dot unpaid" />Reserved / Unpaid</span>
        <span><i className="dispatch-dot vacant" />Vacant</span>
        <span><i className="dispatch-dot blocked" />Blocked</span>
      </div>

      <div className="dispatch-date-picker">
        <input type="date" className="input-sm" value={dateKey} onChange={(e) => e.target.value && loadDate(e.target.value)} />
        <span className="dispatch-date-label">{formatDateHeader(dateKey)}</span>
      </div>

      <div className="dispatch-date-row">
        {dateButtons.map((key) => {
          const d = new Date(key + "T00:00:00");
          return (
            <button key={key} className={`dispatch-date-chip ${key === dateKey ? "active" : ""}`} onClick={() => loadDate(key)}>
              <strong>{formatDateLabel(key)}</strong>
              <span>{["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getDay()]}</span>
            </button>
          );
        })}
      </div>

      <div className="dispatch-grid-wrap" aria-busy={isPending}>
        <div
          className="dispatch-grid"
          style={{ ["--dispatch-courts" as string]: grid.courts.length || 1, ["--dispatch-slots" as string]: visibleRows.length || 1 }}
        >
          <div className="dispatch-time-head" style={{ gridColumn: 1, gridRow: 1 }}><span>Time</span></div>
          {courtsV.map((c, ci) => (
            <div className="dispatch-court-head" key={c.courtId} style={{ gridColumn: ci + 2, gridRow: 1 }}>
              {c.courtName}
              {c.description && <span>{c.description}</span>}
            </div>
          ))}
          {courtsV[0]?.slots.map((_, i) => (
            <Fragment key={i}>
              <div className="dispatch-time-cell" style={{ gridColumn: 1, gridRow: i + 2 }}>
                <span className="dtc-range">
                  <span className="dtc-start">{formatTime(courtsV[0].slots[i].start)}</span>
                  <span className="dtc-dash">–</span>
                  <span className="dtc-end">{formatTime(courtsV[0].slots[i].end)}</span>
                </span>
              </div>
              {courtsV.map((court, ci) => {
                const slot = court.slots[i];
                const isBooking = !!slot.booking;
                // Skip cells covered by a merged block that started above or to the left.
                if (isBooking && (skipRowCont(court.slots, i) || skipCourtCont(ci, i))) return null;
                const rSpan = isBooking ? rowSpanAt(court.slots, i) : 1;
                const cSpan = isBooking ? courtSpanAt(ci, i, rSpan) : 1;
                const blockEnd = court.slots[Math.min(i + rSpan - 1, court.slots.length - 1)].end;
                const selKey = `${court.courtId}__${slot.start}`;
                const isSelected = selected.some((s) => s.key === selKey);
                const awaiting = slot.booking?.paymentStatus === "awaiting_verification";
                const isFilteredOut = filter !== "all" && slot.state !== filter;
                const statusClass = slot.booking ? `booking-status-${String(slot.booking.status || "reserved").toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
                const paymentKebab = String(slot.booking?.paymentStatus || "unpaid").toLowerCase().replace(/[^a-z0-9]+/g, "-");
                const classes = ["dispatch-tile", slot.state, statusClass, isSelected ? "selected" : "", isFilteredOut ? "is-filtered-out" : "", rSpan * cSpan === 1 ? "single-slot-booking" : ""].filter(Boolean).join(" ");
                const selectable = slot.state === "vacant" || slot.state === "blocked";
                const gridStyle = { gridColumn: `${ci + 2} / span ${cSpan}`, gridRow: `${i + 2} / span ${rSpan}` } as const;
                return (
                  <button
                    key={court.courtId}
                    className={classes}
                    style={gridStyle}
                    disabled={slot.state === "maintenance"}
                    onClick={() => {
                      if (isBooking && slot.booking) openBooking(slot.booking.id);
                      else if (selectable) toggleSlot({ courtId: court.courtId, courtName: court.courtName, start: slot.start, end: slot.end, kind: slot.state === "blocked" ? "blocked" : "vacant", blockId: slot.block?.id });
                    }}
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
                        <span className="tile-open-time">{formatClock(slot.start)} - {formatClock(blockEnd)}</span>
                      </>
                    ) : (
                      <>
                        <div className="tile-primary">{slot.booking?.customerName}</div>
                        <div className="tile-booking-summary">
                          {cSpan > 1 ? `${court.courtName}–${courtsV[ci + cSpan - 1].courtName} · ` : ""}
                          {formatClock(slot.start)} - {formatClock(blockEnd)}
                        </div>
                        <div className="tile-financial-row">
                          <span className="tile-financial">
                            {currency} {((slot.booking?.totalMinor ?? 0) / 100).toFixed(2)} · {labelize(slot.booking?.status)}
                          </span>
                          <span className={`tile-payment-medal payment-${paymentKebab}`}>
                            {awaiting ? "Awaiting" : labelize(slot.booking?.paymentStatus)}
                          </span>
                        </div>
                        <div className="dispatch-popover">
                          <strong>{slot.booking?.customerName}</strong>
                          <span>{slot.booking?.reference}</span>
                          <span>{formatClock(slot.start)} - {formatClock(blockEnd)}</span>
                          <span>
                            {currency} {((slot.booking?.totalMinor ?? 0) / 100).toFixed(2)} · {labelize(slot.booking?.status)}
                          </span>
                          <span className="dim">Click to manage →</span>
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

      {opsBooking && (
        <BookingOperationsModal
          booking={opsBooking}
          currency={currency}
          onClose={() => setOpsBooking(null)}
          onChanged={() => {
            setOpsBooking(null);
            refresh();
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
                  {labelize(m)}
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
