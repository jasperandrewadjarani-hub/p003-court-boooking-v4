"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { fetchGridAction, createBookingAction, previewCartTotalAction } from "@/app/actions";
import type { AvailabilityGrid } from "@/lib/booking/availability";
import type { MembershipOption } from "@/lib/booking/memberships";
import { CourtGrid, slotKey } from "@/components/booking/CourtGrid";
import { CartBar, type CartItem } from "@/components/booking/CartBar";

interface TenantInfo {
  name: string;
  slug: string;
  currency: string;
  primaryColor: string;
  accentColor: string;
}

function todayKey(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Deliberately not toLocaleDateString() — see notes.md 2026-08-12 (hydration
// mismatch: server/client ICU data disagreed even with the same `undefined`
// locale argument). A fixed lookup table is deterministic by construction.
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
 * NOTE — Phase B scope: real multi-court/multi-slot cart (v2's actual
 * "click any open slot to toggle it into your cart, across any courts and
 * times, then check out once") — the specific feature the client asked
 * for by name. Customer identification is still "find or create by email"
 * with no password/session (Phase C); receipt upload/payment screen is
 * Phase D.
 */
export function BookingPage({
  tenant,
  initialGrid,
  memberships,
}: {
  tenant: TenantInfo;
  initialGrid: AvailabilityGrid;
  memberships: MembershipOption[];
}) {
  const [dateKey, setDateKey] = useState(initialGrid.date);
  const [grid, setGrid] = useState(initialGrid);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState<"book" | "mine">("book");
  const [membershipType, setMembershipType] = useState("");
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", players: 4 });
  const [preview, setPreview] = useState({ totalMinor: 0, discountMinor: 0 });
  const [status, setStatus] = useState<{ kind: "idle" | "success" | "error"; message?: string; reference?: string; totalMinor?: number }>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  const selectedKeys = useMemo(() => new Set(cart.map((c) => c.key)), [cart]);

  // Live total preview — same calculateCartTotal call the real booking
  // transaction uses (priceCart in create.ts), so this can never drift from
  // what the customer is actually charged. Re-runs whenever the cart or the
  // selected membership changes.
  useEffect(() => {
    if (!cart.length) {
      setPreview({ totalMinor: 0, discountMinor: 0 });
      return;
    }
    let cancelled = false;
    previewCartTotalAction(
      dateKey,
      cart.map((c) => ({ courtId: c.courtId, startTime: c.start, endTime: c.end })),
      membershipType || undefined
    ).then((result) => {
      if (!cancelled) setPreview(result);
    });
    return () => {
      cancelled = true;
    };
  }, [cart, dateKey, membershipType]);

  function loadDate(key: string) {
    setDateKey(key);
    setCart([]);
    setModalOpen(false);
    startTransition(async () => {
      const data = await fetchGridAction(key);
      setGrid(data);
    });
  }

  function onToggleSlot(courtId: string, courtName: string, start: string, end: string) {
    const key = slotKey(courtId, start);
    setStatus({ kind: "idle" });
    setCart((prev) => (prev.some((c) => c.key === key) ? prev.filter((c) => c.key !== key) : [...prev, { key, courtId, courtName, start, end }]));
  }

  function removeCartItem(key: string) {
    setCart((prev) => prev.filter((c) => c.key !== key));
  }

  function submitBooking() {
    if (!cart.length) return;
    if (!form.firstName || !form.lastName || !form.email || !form.phone) {
      setStatus({ kind: "error", message: "Fill in all fields." });
      return;
    }
    startTransition(async () => {
      const res = await createBookingAction({
        dateKey,
        items: cart.map((c) => ({ courtId: c.courtId, startTime: c.start, endTime: c.end })),
        players: form.players,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        membershipType: membershipType || undefined,
      });
      if (res.ok) {
        setStatus({ kind: "success", reference: res.result.reference, totalMinor: res.result.totalMinor });
        setCart([]);
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

  const totalHours = cart.reduce((sum, c) => {
    const [sh, sm] = c.start.split(":").map(Number);
    const [eh, em] = c.end.split(":").map(Number);
    return sum + (eh * 60 + em - (sh * 60 + sm)) / 60;
  }, 0);

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
                Tap multiple open slots to add them to your booking, across any court. Updates live — no refresh needed.
              </p>
              <div key={dateKey}>
                <CourtGrid grid={grid} selectedKeys={selectedKeys} onToggleSlot={onToggleSlot} isPending={isPending} />
              </div>
            </div>

            <CartBar
              items={cart}
              totalHoursLabel={`${cart.length} slot${cart.length === 1 ? "" : "s"} selected · ${totalHours}h total`}
              totalText={cart.length ? `${tenant.currency} ${(preview.totalMinor / 100).toFixed(2)}` : "—"}
              onRemove={removeCartItem}
              onContinue={() => setModalOpen(true)}
            />
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

      {modalOpen && cart.length > 0 && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <span className="close" onClick={() => setModalOpen(false)}>
              [ ESC ]
            </span>
            <h3>Confirm Booking</h3>

            <div className="grouped-booking-block">
              <div className="grouped-booking-head">
                <strong>{cart.length} item{cart.length === 1 ? "" : "s"}</strong>
                <span>{formatDateLabel(dateKey)}</span>
              </div>
              {cart.map((item) => (
                <div className="grouped-booking-item" key={item.key}>
                  <div className="booking-court-identity">
                    <strong>{item.courtName}</strong>
                  </div>
                  <span className="grouped-booking-time">
                    {formatTime(item.start)}–{formatTime(item.end)}
                  </span>
                </div>
              ))}
              <div className="grouped-booking-total">
                <span>Estimated Total</span>
                <strong>
                  {tenant.currency} {(preview.totalMinor / 100).toFixed(2)}
                </strong>
              </div>
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
            <select value={membershipType} onChange={(e) => setMembershipType(e.target.value)}>
              <option value="">No Membership</option>
              {memberships.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} (−{m.discountPercent}%)
                </option>
              ))}
            </select>

            <div className="total-line">
              <span>Estimated Total</span>
              <span>
                {tenant.currency} {(preview.totalMinor / 100).toFixed(2)}
              </span>
            </div>

            <button className="btn block" style={{ marginTop: 18 }} onClick={submitBooking} disabled={isPending}>
              {isPending ? "Booking…" : "Confirm Booking"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
