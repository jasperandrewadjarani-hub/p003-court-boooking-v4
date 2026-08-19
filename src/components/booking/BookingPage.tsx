"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { fetchGridAction, createBookingAction, previewCartTotalAction } from "@/app/actions";
import { beginCustomerBookingAuth } from "@/lib/auth/customerAuth";
import type { AvailabilityGrid } from "@/lib/booking/availability";
import type { MembershipOption } from "@/lib/booking/memberships";
import { CourtGrid, slotKey } from "@/components/booking/CourtGrid";
import { CartBar, type CartItem } from "@/components/booking/CartBar";
import { AccountModal } from "@/components/booking/AccountModal";
import { MyBookingsPanel } from "@/components/booking/MyBookingsPanel";
import { SuccessModal } from "@/components/booking/SuccessModal";
import { ReceiptReminderModal } from "@/components/booking/ReceiptReminderModal";
import type { PaymentSettings } from "@/lib/booking/paymentSettings";

interface TenantInfo {
  name: string;
  slug: string;
  currency: string;
  logoUrl?: string | null;
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
// v3b date-chip format: "17-Aug" over "MON".
function formatDateChip(dateKey: string): { weekday: string; day: string } {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return { weekday: WEEKDAYS[date.getDay()], day: `${d}-${MONTHS[m - 1]}` };
}

function formatDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

// v3b short form: "17-Aug-26" (grid label / calendar display).
function formatDateShort(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return `${d}-${MONTHS[m - 1]}-${String(y).slice(2)}`;
}

// v3b confirm-modal date header: "17-Aug-26 (Mon)".
function formatDateHeader(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${formatDateShort(dateKey)} (${WEEKDAYS[date.getDay()]})`;
}

// Live update every 20s (matches the admin dispatch grid's poll cadence) so a
// slot someone else just booked stops reading "Open" until the customer
// happens to change dates or reload.
const POLL_MS = 20_000;

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
}

// Merge back-to-back slots on the same court into one line for the confirm
// summary (v3b: "Court 1 8:00 am – 10:00 am" for two adjacent hourly slots).
function mergeCartByCourt(cart: CartItem[]): { courtId: string; courtName: string; start: string; end: string }[] {
  const byCourt = new Map<string, CartItem[]>();
  for (const item of cart) {
    if (!byCourt.has(item.courtId)) byCourt.set(item.courtId, []);
    byCourt.get(item.courtId)!.push(item);
  }
  const merged: { courtId: string; courtName: string; start: string; end: string }[] = [];
  for (const [courtId, items] of byCourt) {
    const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
    let run = { start: sorted[0].start, end: sorted[0].end };
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start === run.end) {
        run.end = sorted[i].end; // contiguous — extend
      } else {
        merged.push({ courtId, courtName: sorted[0].courtName, start: run.start, end: run.end });
        run = { start: sorted[i].start, end: sorted[i].end };
      }
    }
    merged.push({ courtId, courtName: sorted[0].courtName, start: run.start, end: run.end });
  }
  return merged;
}

/**
 * Full customer-facing flow: multi-court/multi-slot cart (Phase B), real
 * OTP/password accounts (Phase C), and the post-booking payment/receipt
 * screen (Phase D) are all live.
 */
export function BookingPage({
  tenant,
  initialGrid,
  memberships,
  paymentSettings,
  reservationHoldMinutes,
  maxCourtHoursPerBooking,
  maxAdvanceBookingDays,
  hasActiveDiscount,
}: {
  tenant: TenantInfo;
  initialGrid: AvailabilityGrid;
  memberships: MembershipOption[];
  paymentSettings: PaymentSettings;
  reservationHoldMinutes: number;
  maxCourtHoursPerBooking: number;
  maxAdvanceBookingDays: number;
  hasActiveDiscount: boolean;
}) {
  const [dateKey, setDateKey] = useState(initialGrid.date);
  const [grid, setGrid] = useState(initialGrid);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState<"book" | "mine">("book");
  const [membershipType, setMembershipType] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [preview, setPreview] = useState<{ totalMinor: number; discountMinor: number; discountError?: string }>({ totalMinor: 0, discountMinor: 0 });
  const [status, setStatus] = useState<{ kind: "idle" | "error"; message?: string }>({ kind: "idle" });
  const [completedBooking, setCompletedBooking] = useState<{ bookingGroupId: string; reference: string; totalMinor: number; justBookedKeys: string[] } | null>(null);
  const [showReceiptReminder, setShowReceiptReminder] = useState(false);
  // Post-booking "spark" — briefly highlights the just-booked slots in the
  // grid and shows a "Booking Created" toast once the success modal(s) close
  // and the grid becomes visible again (client asked for this — v3b has no
  // equivalent, it just does a plain silent refresh).
  const [highlightKeys, setHighlightKeys] = useState<Set<string>>(new Set());
  const [bookingToast, setBookingToast] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [accountModal, setAccountModal] = useState<{ mode: "login" | "register"; devCode?: string } | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

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
    // Small debounce so typing a discount code doesn't fire a request per key.
    const handle = setTimeout(() => {
      previewCartTotalAction(
        dateKey,
        cart.map((c) => ({ courtId: c.courtId, startTime: c.start, endTime: c.end })),
        membershipType || undefined,
        discountCode.trim() || undefined
      ).then((result) => {
        if (!cancelled) setPreview(result);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [cart, dateKey, membershipType, discountCode]);

  // Light/dark theme toggle (v3b) — persisted to localStorage, applied to the
  // document root so tokens.css's [data-theme="light"] palette takes over.
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const saved = (localStorage.getItem("volt_theme") as "dark" | "light" | null) ?? "dark";
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
  }, []);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("volt_theme", next);
  }

  function loadDate(key: string) {
    setDateKey(key);
    setCart([]);
    setModalOpen(false);
    startTransition(async () => {
      const data = await fetchGridAction(key);
      setGrid(data);
    });
  }

  // Quiet background refresh — a slot someone else just booked (or one that
  // just lapsed back open) updates on its own instead of staying stale until
  // the customer changes dates or reloads. Doesn't touch the cart selection.
  useEffect(() => {
    const id = setInterval(() => {
      fetchGridAction(dateKey).then(setGrid);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [dateKey]);

  function onToggleSlot(courtId: string, courtName: string, start: string, end: string) {
    const key = slotKey(courtId, start);
    setStatus({ kind: "idle" });
    setCart((prev) => (prev.some((c) => c.key === key) ? prev.filter((c) => c.key !== key) : [...prev, { key, courtId, courtName, start, end }]));
  }

  function removeCartItem(key: string) {
    setCart((prev) => prev.filter((c) => c.key !== key));
  }

  function clearSelection() {
    setCart([]);
    setStatus({ kind: "idle" });
  }

  // Step 1: booking modal "Continue → Sign In" — determines register vs.
  // login by email (matches v2's beginCustomerBookingAuth exactly) and
  // opens the account modal. Doesn't book anything yet.
  function continueToAccount() {
    if (!cart.length) return;
    if (!form.firstName || !form.lastName || !form.email || !form.phone) {
      setAuthError("Please input required information. First name, last name, mobile number, and email are all required.");
      return;
    }
    // A discount code the customer typed but never resolved successfully
    // (v3b: invalid/exhausted codes block checkout, they don't silently
    // fall through to sign-in with no discount applied).
    if (preview.discountError) {
      setAuthError(preview.discountError);
      return;
    }
    setAuthError(null);
    startTransition(async () => {
      const result = await beginCustomerBookingAuth(form.email);
      if (!result.ok) {
        setAuthError(result.error);
        return;
      }
      setModalOpen(false);
      if (result.mode === "login") {
        setAccountModal({ mode: "login" });
      } else {
        setAccountModal({ mode: "register", devCode: "devCode" in result ? result.devCode : undefined });
      }
    });
  }

  // Step 2: called by AccountModal once registration/login succeeds — the
  // session is now established, so the booking transaction can trust it.
  function submitBooking() {
    const bookedKeys = cart.map((c) => c.key); // captured before the cart is cleared below
    startTransition(async () => {
      const res = await createBookingAction({
        dateKey,
        items: cart.map((c) => ({ courtId: c.courtId, startTime: c.start, endTime: c.end })),
        players: 1, // v3b removed Number of Players — backend stores 1
        membershipType: membershipType || undefined,
        discountCode: discountCode.trim() || undefined,
      });
      setAccountModal(null);
      if (res.ok) {
        setStatus({ kind: "idle" }); // clear any stale error from an earlier failed attempt
        setDiscountCode(""); // don't leave a resolved/rejected code sitting in the box for the next booking
        setCompletedBooking({ bookingGroupId: res.result.bookingGroupId, reference: res.result.reference, totalMinor: res.result.totalMinor, justBookedKeys: bookedKeys });
        setCart([]);
        const fresh = await fetchGridAction(dateKey);
        setGrid(fresh);
      } else {
        // Re-open the confirm-details form instead of dumping the customer
        // back to the bare grid — the cart/form state is all still intact,
        // only the modal visibility flags were reset. (Reported bug: a
        // failed attempt "randomly exits the form.")
        setModalOpen(true);
        setAuthError(res.error);
      }
    });
  }

  // ESC: closes the topmost thing first (account modal, then the confirm-
  // details modal), and only once nothing is open does it clear the current
  // slot selection — matching the requested "ESC should also exit all
  // selections" behavior without eating an ESC meant to just close a modal.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (accountModal) {
        setAccountModal(null);
      } else if (modalOpen) {
        setModalOpen(false);
      } else if (cart.length) {
        clearSelection();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [accountModal, modalOpen, cart.length]);

  // "Done" in SuccessModal — nag once if no receipt was uploaded (matches
  // v2's ReceiptReminderModal), since the reservation auto-lapses after
  // reservationHoldMinutes if unpaid (Phase B's sweepLapsedBookings).
  function onSuccessDone(receiptUploaded: boolean) {
    if (!receiptUploaded) {
      setShowReceiptReminder(true);
    } else {
      dismissToGrid();
    }
  }

  // Closes whichever post-booking modal is open and reveals the grid — the
  // freshly-booked slots are already rendered as Booked underneath (the grid
  // was refetched right after the booking succeeded), so this is the moment
  // to spark them and show the "Booking Created" toast, for ~5 seconds.
  function dismissToGrid() {
    const keys = completedBooking?.justBookedKeys ?? [];
    setCompletedBooking(null);
    setShowReceiptReminder(false);
    if (keys.length) {
      setHighlightKeys(new Set(keys));
      setBookingToast("Booking Created");
      setTimeout(() => {
        setHighlightKeys(new Set());
        setBookingToast(null);
      }, 5000);
    }
  }

  const dateButtons = Array.from({ length: 14 }, (_, i) => todayKey(i));
  const maxPickDate = todayKey(maxAdvanceBookingDays);

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
    <main>
      <div className="jt-brand-bar">
        <a href="https://www.facebook.com/profile.php?id=61590234100280" target="_blank" rel="noopener noreferrer">
          Powered by JT Consulting &amp; Analytics
        </a>
      </div>

      <button className="theme-toggle" onClick={toggleTheme}>
        {theme === "dark" ? "☾ Light Mode" : "☀ Dark Mode"}
      </button>

      <div className={`booking-toast ${bookingToast ? "visible" : ""}`} role="status">
        ✓ {bookingToast}
      </div>

      <div className="ticker">
        <div className="ticker__track">{occupancyText}</div>
      </div>

      <header className="hud">
        {tenant.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tenant.logoUrl} alt={tenant.name} className="hud-logo" />
        ) : null}
        <h1 className="brand">
          <span>{tenant.name}</span>
        </h1>
        <div className="brand-sub">LIVE COURT AVAILABILITY | TAP SLOTS TO BUILD YOUR BOOKING</div>
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
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <label style={{ margin: 0, whiteSpace: "nowrap" }}>Or pick any date</label>
                <input
                  type="date"
                  value={dateKey}
                  min={todayKey(0)}
                  max={maxPickDate}
                  style={{ maxWidth: 200 }}
                  onChange={(e) => e.target.value && loadDate(e.target.value)}
                />
                <span className="mono dim" style={{ fontSize: 11 }}>{formatDateShort(dateKey)}</span>
              </div>
            </div>

            <div className="panel grid-panel-wide" style={{ marginBottom: 0 }}>
              <div className="panel__title">
                Court Grid — <span className="mono dim">{formatDateLabel(dateKey)}</span>
              </div>
              <p className="dim mono" style={{ fontSize: 11, marginTop: -8 }}>
                Tap multiple open slots to add them to your booking, across any court. Updates live. No refresh needed.
              </p>
              <div key={dateKey}>
                <CourtGrid grid={grid} selectedKeys={selectedKeys} highlightKeys={highlightKeys} onToggleSlot={onToggleSlot} isPending={isPending} />
              </div>
            </div>

            <CartBar
              items={cart}
              totalHoursLabel={`${totalHours.toFixed(1)} / ${maxCourtHoursPerBooking} court-hours`}
              totalText={cart.length ? `${tenant.currency} ${(preview.totalMinor / 100).toFixed(2)}` : "—"}
              onRemove={removeCartItem}
              onClearAll={clearSelection}
              onContinue={() => setModalOpen(true)}
            />
          </>
        ) : (
          <MyBookingsPanel currency={tenant.currency} />
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
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); continueToAccount(); }}
            onKeyDown={(e) => {
              // Native "Enter submits the form" isn't reliable across every
              // input combination/browser — v3b doesn't depend on it either
              // (JS.html wires an explicit keydown listener per field). Match
              // that: Enter on any text field here submits directly.
              if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
                e.preventDefault();
                continueToAccount();
              }
            }}
          >
            <span className="close" onClick={() => setModalOpen(false)}>
              [ ESC ]
            </span>
            <h3>Confirm Booking</h3>

            <div className="grouped-booking-block">
              <div className="grouped-booking-head">
                <strong className="grouped-booking-date">{formatDateHeader(dateKey)}</strong>
                <span>Booking Summary</span>
              </div>
              {mergeCartByCourt(cart).map((item) => (
                <div className="grouped-booking-item" key={item.courtId + item.start}>
                  <div className="booking-court-identity">
                    <strong>{item.courtName}</strong>
                  </div>
                  <span className="grouped-booking-time">
                    {formatTime(item.start)} – {formatTime(item.end)}
                  </span>
                </div>
              ))}
              <div className="grouped-booking-total">
                <span>Total Court Hours</span>
                <strong>{totalHours.toFixed(1)} court hrs</strong>
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
            <label>Membership</label>
            <select value={membershipType} onChange={(e) => setMembershipType(e.target.value)} disabled={memberships.length === 0}>
              {memberships.length === 0 ? (
                <option value="">No active memberships</option>
              ) : (
                <>
                  <option value="">No Membership</option>
                  {memberships.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name} (−{m.discountPercent}%)
                    </option>
                  ))}
                </>
              )}
            </select>
            <label>Discount Code (optional)</label>
            <input
              value={discountCode}
              onChange={(e) => setDiscountCode(e.target.value)}
              placeholder={hasActiveDiscount ? "Enter code" : "No active discount codes"}
              disabled={!hasActiveDiscount}
            />
            {preview.discountError ? (
              <div className="field-warning">{preview.discountError}</div>
            ) : preview.discountMinor > 0 ? (
              <div className="summary-line">
                <span>Discount</span>
                <strong>− {tenant.currency} {(preview.discountMinor / 100).toFixed(2)}</strong>
              </div>
            ) : null}

            <div className="total-line">
              <span>Estimated Total</span>
              <span>
                {tenant.currency} {(preview.totalMinor / 100).toFixed(2)}
              </span>
            </div>

            {authError && <div className="field-warning">{authError}</div>}
            <button type="submit" className="btn block" style={{ marginTop: 18 }} disabled={isPending}>
              {isPending ? "Working…" : "Continue → Sign In"}
            </button>
          </form>
        </div>
      )}

      {accountModal && (
        <AccountModal
          email={form.email}
          mode={accountModal.mode}
          devCode={accountModal.devCode}
          profile={{ firstName: form.firstName, lastName: form.lastName, phone: form.phone }}
          onAuthenticated={submitBooking}
          onClose={() => setAccountModal(null)}
        />
      )}

      {completedBooking && !showReceiptReminder && (
        <SuccessModal
          bookingGroupId={completedBooking.bookingGroupId}
          reference={completedBooking.reference}
          totalMinor={completedBooking.totalMinor}
          currency={tenant.currency}
          reservationHoldMinutes={reservationHoldMinutes}
          paymentSettings={paymentSettings}
          onDone={onSuccessDone}
        />
      )}

      {completedBooking && showReceiptReminder && (
        <ReceiptReminderModal
          reservationHoldMinutes={reservationHoldMinutes}
          onReturnToUpload={() => setShowReceiptReminder(false)}
          onProceedAnyway={dismissToGrid}
        />
      )}
    </main>
  );
}
