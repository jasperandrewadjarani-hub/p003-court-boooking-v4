"use client";

import { useEffect, useState, useTransition } from "react";
import { fetchMyBookingsAction, cancelMyBookingAction } from "@/app/actions";
import { loginCustomer } from "@/lib/auth/customerAuth";
import type { MyBookingGroup } from "@/lib/booking/customerBookings";

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
}

const STATUS_LABELS: Record<string, string> = {
  reserved: "Reserved",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  lapsed: "Lapsed",
  no_show: "NoShow",
};

/** Matches v2's "My Bookings" tab: email+password login gate, then a list
 * of the signed-in customer's own booking groups as grouped-booking-blocks
 * with a Cancel action on cancellable ones. */
export function MyBookingsPanel({ currency }: { currency: string }) {
  const [bookings, setBookings] = useState<MyBookingGroup[] | null | undefined>(undefined); // undefined = not checked yet
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      const result = await fetchMyBookingsAction();
      setBookings(result);
    });
  }

  useEffect(() => {
    refresh();
  }, []);

  function submitLogin() {
    setError(null);
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

  if (bookings === undefined) {
    return (
      <div className="panel">
        <div className="panel__title">Look Up My Bookings</div>
        <p className="dim mono">Loading…</p>
      </div>
    );
  }

  if (bookings === null) {
    return (
      <div className="panel">
        <div className="panel__title">Look Up My Bookings</div>
        <label>Email Address</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        {error && <div className="field-warning">{error}</div>}
        <button className="btn block" style={{ marginTop: 14 }} onClick={submitLogin} disabled={isPending}>
          {isPending ? "Working…" : "Find My Bookings"}
        </button>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel__title">My Bookings</div>
      {error && <div className="field-warning">{error}</div>}
      {!bookings.length && <p className="dim mono">No bookings yet.</p>}
      {bookings.map((group) => (
        <div className="grouped-booking-block" key={group.id}>
          <div className="grouped-booking-head">
            <strong>{group.reference ?? "Pending"}</strong>
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
            <span>
              {group.paymentStatus === "paid" ? "Paid" : group.paymentStatus === "awaiting_verification" ? "Awaiting Verification" : "Unpaid"}
            </span>
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
      ))}
    </div>
  );
}
