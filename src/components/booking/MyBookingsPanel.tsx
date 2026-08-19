"use client";

import { useState, useTransition } from "react";
import { fetchMyBookingsAction, cancelMyBookingAction } from "@/app/actions";
import { loginCustomer } from "@/lib/auth/customerAuth";
import type { MyBookingGroup } from "@/lib/booking/customerBookings";

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatDateLabel(dateKey: string): string {
  if (!dateKey) return "";
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${d}-${MONTHS[m - 1]}-${String(y).slice(2)} (${WEEKDAYS[date.getDay()]})`;
}

const STATUS_LABELS: Record<string, string> = {
  reserved: "Reserved",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  lapsed: "Lapsed",
  no_show: "NoShow",
};

// Active bookings (reserved/confirmed) surface first; lapsed/cancelled/
// no-show sink to the bottom. Within each bucket, order from the server
// (newest-created first) is preserved — Array.sort is stable.
const ACTIVE_STATUSES = new Set(["reserved", "confirmed"]);
function sortForDisplay(groups: MyBookingGroup[]): MyBookingGroup[] {
  return [...groups].sort((a, b) => Number(ACTIVE_STATUSES.has(b.status)) - Number(ACTIVE_STATUSES.has(a.status)));
}

/** Matches v2's "My Bookings" tab: email+password login gate, then a list
 * of the signed-in customer's own booking groups as grouped-booking-blocks
 * with a Cancel action on cancellable ones.
 *
 * Deliberately does NOT auto-restore from an existing customer_session —
 * v3b's lookupBookings() always requires email+password to be typed on this
 * tab, even moments after signing in on the booking form itself, and the
 * client asked v4 to match that exactly (2026-08-19 feedback). */
export function MyBookingsPanel({ currency }: { currency: string }) {
  const [bookings, setBookings] = useState<MyBookingGroup[] | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      const result = await fetchMyBookingsAction();
      setBookings(result ?? []);
    });
  }

  function submitLogin() {
    setError(null);
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    startTransition(async () => {
      try {
        await loginCustomer(email, password);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  function cancel(bookingGroupId: string) {
    startTransition(async () => {
      const res = await cancelMyBookingAction(bookingGroupId);
      if (res.ok) refresh();
      else setError(res.error);
    });
  }

  if (bookings === null) {
    return (
      <div className="panel">
        <div className="panel__title">Look Up My Bookings</div>
        <form onSubmit={(e) => { e.preventDefault(); submitLogin(); }}>
          <label>Email Address</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          {error && <div className="field-warning">{error}</div>}
          <button type="submit" className="btn block" style={{ marginTop: 14 }} disabled={isPending}>
            {isPending ? "Working…" : "Find My Bookings"}
          </button>
        </form>
      </div>
    );
  }

  const sorted = sortForDisplay(bookings);

  return (
    <div className="panel">
      <div className="panel__title">My Bookings</div>
      {error && <div className="field-warning">{error}</div>}
      {!sorted.length && <p className="dim mono">No bookings yet.</p>}
      {sorted.map((group) => {
        const receiptState =
          group.hasReceipt && group.paymentStatus === "awaiting_verification"
            ? "Receipt Uploaded → Awaiting Verification"
            : group.hasReceipt && group.paymentStatus === "paid"
              ? "Receipt Uploaded → Payment Confirmed"
              : group.paymentStatus === "paid"
                ? "Paid"
                : group.paymentStatus === "awaiting_verification"
                  ? "Awaiting Verification"
                  : "Unpaid";
        return (
          <div className="grouped-booking-block" key={group.id}>
            <div className="grouped-booking-head">
              <strong className="grouped-booking-date">{formatDateLabel(group.dateLabel)}</strong>
              <span>{group.reference ?? "Pending"}</span>
              <span className={`status-pill ${STATUS_LABELS[group.status] ?? group.status}`}>{STATUS_LABELS[group.status] ?? group.status}</span>
            </div>
            {group.items.map((item, i) => (
              <div className="grouped-booking-item" key={i}>
                <div className="booking-court-identity">
                  <strong>{item.courtName}</strong>
                </div>
                <span className="grouped-booking-time">
                  {formatTime(item.start)}–{formatTime(item.end)}
                </span>
              </div>
            ))}
            <div className="grouped-booking-total">
              <span className={group.hasReceipt ? "receipt-state uploaded" : undefined}>{receiptState}</span>
              <strong>
                {currency} {(group.totalMinor / 100).toFixed(2)}
              </strong>
            </div>
            {(group.status === "reserved" || group.status === "confirmed") && (
              <button className="btn danger" style={{ margin: 10 }} onClick={() => cancel(group.id)} disabled={isPending}>
                Cancel Booking
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
