"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { fetchGridAction, createBookingAction } from "@/app/actions";
import type { AvailabilityGrid } from "@/lib/booking/availability";

interface TenantInfo {
  name: string;
  slug: string;
  currency: string;
  primaryColor: string;
  accentColor: string;
}

interface SelectedSlot {
  courtId: string;
  courtName: string;
  start: string;
  end: string;
}

function todayKey(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Deliberately not toLocaleDateString(): its output depends on the ICU/Intl
// data available in the runtime, which differs between the Node.js server
// (SSR) and the browser (hydration) even with the same `undefined` locale
// argument — a real bug hit while testing this slice (server rendered
// "Wed 12 Aug", client rendered "Wed, 12 Aug", React discarded and
// re-rendered the whole tree). A fixed lookup table is deterministic.
function formatDateChip(dateKey: string): { weekday: string; day: string } {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return { weekday: WEEKDAYS[date.getDay()], day: `${d} ${MONTHS[m - 1]}` };
}

function formatDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
}

/**
 * NOTE — Phase A scope only (VOLT visual port). Real markup/class names
 * from v2's Index.html, real HUD grid, real cart-bar/modal components. Still
 * single-slot selection under the hood (the cart-bar below currently holds
 * at most one item) — the actual multi-court/multi-slot cart mechanic is
 * Phase B, which slots into this same cart-bar/modal shell. Membership
 * pricing, real customer accounts, and receipt upload are Phase B/C/D.
 */
export function BookingPage({ tenant, initialGrid }: { tenant: TenantInfo; initialGrid: AvailabilityGrid }) {
  const [dateKey, setDateKey] = useState(initialGrid.date);
  const [grid, setGrid] = useState(initialGrid);
  const [selected, setSelected] = useState<SelectedSlot | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState<"book" | "mine">("book");
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", players: 4 });
  const [status, setStatus] = useState<{ kind: "idle" | "success" | "error"; message?: string; reference?: string; totalMinor?: number }>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function loadDate(key: string) {
    setDateKey(key);
    setSelected(null);
    setModalOpen(false);
    startTransition(async () => {
      const data = await fetchGridAction(key);
      setGrid(data);
    });
  }

  function onSlotClick(courtId: string, courtName: string, start: string, end: string) {
    setSelected({ courtId, courtName, start, end });
    setStatus({ kind: "idle" });
  }

  function removeSelected() {
    setSelected(null);
  }

  function submitBooking() {
    if (!selected) return;
    if (!form.firstName || !form.lastName || !form.email || !form.phone) {
      setStatus({ kind: "error", message: "Fill in all fields." });
      return;
    }
    startTransition(async () => {
      const res = await createBookingAction({
        dateKey,
        courtId: selected.courtId,
        startTime: selected.start,
        endTime: selected.end,
        players: form.players,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
      });
      if (res.ok) {
        setStatus({ kind: "success", reference: res.result.reference, totalMinor: res.result.totalMinor });
        setSelected(null);
        setModalOpen(false);
        const fresh = await fetchGridAction(dateKey);
        setGrid(fresh);
      } else {
        setStatus({ kind: "error", message: res.error });
      }
    });
  }

  const dateButtons = Array.from({ length: 7 }, (_, i) => todayKey(i));

  const occupancyText = useMemo(() => {
    if (!grid.courts.length) return "SYNCING COURT STATUS";
    const parts = grid.courts.map((c) => {
      const total = c.slots.length || 1;
      const booked = c.slots.filter((s) => s.status === "booked").length;
      return `${c.name.toUpperCase()}: ${Math.round((booked / total) * 100)}%`;
    });
    return `${tenant.name.toUpperCase()} :// ${formatDateLabel(dateKey).toUpperCase()} OCCUPANCY — ${parts.join(" · ")} :: TAP OPEN SLOTS TO BUILD YOUR BOOKING ::`;
  }, [grid, dateKey, tenant.name]);

  return (
    <main style={{ ["--tenant-primary" as string]: tenant.primaryColor, ["--tenant-accent" as string]: tenant.accentColor }}>
      <div className="jt-brand-bar">
        <a href="https://www.facebook.com/profile.php?id=61590234100280" target="_blank" rel="noopener noreferrer">
          Powered by JT Consulting &amp; Analytics
        </a>
      </div>

      <div className="ticker">
        <div className="ticker__track">{occupancyText}</div>
      </div>

      <header className="hud">
        <h1 className="brand">
          <span>{tenant.name}</span>
        </h1>
        <div className="brand-sub">LIVE COURT AVAILABILITY — TAP SLOTS TO BUILD YOUR BOOKING</div>
      </header>

      <div className="shell">
        <div className="tabs">
          <div className={`tab ${tab === "book" ? "active" : ""}`} onClick={() => setTab("book")}>
            Book a Court
          </div>
          <div className={`tab ${tab === "mine" ? "active" : ""}`} onClick={() => setTab("mine")}>
            My Bookings
          </div>
        </div>

        {tab === "book" ? (
          <>
            <div className="panel">
              <div className="panel__title">Select Date</div>
              <div className="date-row">
                {dateButtons.map((key) => {
                  const chip = formatDateChip(key);
                  return (
                    <button key={key} type="button" className={`date-chip ${key === dateKey ? "active" : ""}`} onClick={() => loadDate(key)}>
                      <strong>{chip.day}</strong>
                      <span>{chip.weekday}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="panel grid-panel-wide" style={{ marginBottom: 0 }}>
              <div className="panel__title">
                Court Grid — <span className="mono dim">{formatDateLabel(dateKey)}</span>
              </div>
              <p className="dim mono" style={{ fontSize: 11, marginTop: -8 }}>
                Tap an open slot to select it. Updates live — no refresh needed.
              </p>
              <div className="grid-wrap" key={dateKey} aria-busy={isPending}>
                <div
                  className="court-grid"
                  style={{ ["--court-count" as string]: grid.courts.length || 1 }}
                >
                  <div className="head" />
                  {grid.courts.map((c) => (
                    <div className="head" key={c.id}>
                      <strong>{c.name}</strong>
                      <span>{c.description ?? (c.indoor ? "Indoor" : "Outdoor")}</span>
                    </div>
                  ))}
                  {grid.courts[0]?.slots.map((_, i) => (
                    <Fragment key={i}>
                      <div className="time-label">{formatTime(grid.courts[0].slots[i].start)}</div>
                      {grid.courts.map((court) => {
                        const slot = court.slots[i];
                        const isSelected = selected?.courtId === court.id && selected.start === slot.start;
                        const clickable = slot.status === "available";
                        const classes = ["slot", slot.status, isSelected ? "selected" : ""].filter(Boolean).join(" ");
                        return (
                          <div
                            key={court.id}
                            className={classes}
                            onClick={() => clickable && onSlotClick(court.id, court.name, slot.start, slot.end)}
                            role={clickable ? "button" : undefined}
                          >
                            <span className="slot-label">
                              {isSelected ? "Selected" : slot.status === "available" ? "Open" : slot.status === "booked" ? "Booked" : "Maint."}
                            </span>
                          </div>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            </div>

            <div className={`cart-bar ${selected ? "visible" : ""}`}>
              <div className="cart-bar__items">
                {selected && (
                  <span className="cart-chip">
                    {selected.courtName} · {formatTime(selected.start)}–{formatTime(selected.end)}
                    <button type="button" onClick={removeSelected} aria-label="Remove">
                      ✕
                    </button>
                  </span>
                )}
              </div>
              <div className="cart-bar__row">
                <span className="mono dim">1 slot selected</span>
                <button className="btn" onClick={() => setModalOpen(true)} disabled={!selected}>
                  Continue
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="panel">
            <div className="panel__title">Look Up My Bookings</div>
            <p className="dim mono" style={{ fontSize: 13 }}>
              Customer accounts and booking lookup are coming in the next build phase — not wired up yet.
            </p>
          </div>
        )}

        {status.kind === "success" && (
          <div className="panel" style={{ borderColor: "var(--accent-optic)" }}>
            <div className="panel__title" style={{ color: "var(--accent-optic)" }}>
              Booking Successful
            </div>
            <p className="mono">
              Booking ID: <strong>{status.reference}</strong>
            </p>
            <div className="total-line">
              <span>Total</span>
              <span>
                {tenant.currency} {((status.totalMinor ?? 0) / 100).toFixed(2)}
              </span>
            </div>
          </div>
        )}
        {status.kind === "error" && (
          <div className="panel" style={{ borderColor: "var(--accent-magenta)" }}>
            <span className="field-warning">{status.message}</span>
          </div>
        )}
      </div>

      <footer>
        <span>{tenant.name}</span>
      </footer>
      <div className="jt-brand-bar footer-bar">
        <a href="https://www.facebook.com/profile.php?id=61590234100280" target="_blank" rel="noopener noreferrer">
          Powered by JT Consulting &amp; Analytics
        </a>
      </div>

      {modalOpen && selected && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <span className="close" onClick={() => setModalOpen(false)}>
              [ ESC ]
            </span>
            <h3>Confirm Booking</h3>
            <div className="summary-line">
              <span>{selected.courtName}</span>
              <strong>
                {formatTime(selected.start)}–{formatTime(selected.end)}
              </strong>
            </div>

            <label>First Name</label>
            <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            <label>Last Name</label>
            <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            <label>Mobile Number</label>
            <input type="tel" placeholder="09XX XXX XXXX" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <label>Email (your booking account)</label>
            <input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <label>Number of Players</label>
            <input type="number" min={1} value={form.players} onChange={(e) => setForm({ ...form, players: Number(e.target.value) })} />
            <label>Membership</label>
            <select disabled>
              <option>No Membership</option>
            </select>

            <button className="btn block" style={{ marginTop: 18 }} onClick={submitBooking} disabled={isPending}>
              {isPending ? "Booking…" : "Confirm Booking"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
