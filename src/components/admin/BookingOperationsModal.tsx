"use client";

import { useState } from "react";
import { updateBookingGroupAction, recordPaymentAction, updateBookingStatusAction, cancelBookingGroupAction } from "@/app/admin/actions";
import type { AdminBookingGroup } from "@/lib/admin/bookings";

const PAYMENT_METHODS = ["cash", "gcash", "maya", "credit_card", "bank_transfer"] as const;
const STATUSES = ["reserved", "confirmed", "checked_in", "playing", "finished", "cancelled", "lapsed", "no_show"] as const;

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
}

/** Matches v2's Edit Booking modal — contact/notes edit, payment ledger,
 * status transitions, cancel. Court/date/time are intentionally not
 * editable here (cancel and rebook instead). */
export function BookingOperationsModal({ booking, currency, onClose, onChanged }: { booking: AdminBookingGroup; currency: string; onClose: () => void; onChanged: () => void }) {
  const [firstName, lastName] = booking.customerName.split(" ", 2);
  const [form, setForm] = useState({ firstName: firstName ?? "", lastName: lastName ?? "", phone: booking.phone ?? "", notes: booking.notes ?? "" });
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<(typeof PAYMENT_METHODS)[number]>("cash");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>(booking.status as (typeof STATUSES)[number]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function saveDetails() {
    setPending(true);
    setError(null);
    const res = await updateBookingGroupAction(booking.id, { firstName: form.firstName, lastName: form.lastName, mobileNumber: form.phone, notes: form.notes });
    setPending(false);
    if (res.ok) onChanged();
    else setError(res.error);
  }

  async function recordPay() {
    const amountMinor = Math.round(Number(payAmount) * 100);
    if (!amountMinor || amountMinor <= 0) {
      setError("Enter a valid payment amount.");
      return;
    }
    setPending(true);
    setError(null);
    const res = await recordPaymentAction(booking.id, payMethod, amountMinor);
    setPending(false);
    if (res.ok) {
      setPayAmount("");
      onChanged();
    } else {
      setError(res.error);
    }
  }

  async function saveStatus() {
    setPending(true);
    setError(null);
    const res = await updateBookingStatusAction(booking.id, status);
    setPending(false);
    if (res.ok) onChanged();
    else setError(res.error);
  }

  async function cancel() {
    setPending(true);
    setError(null);
    const res = await cancelBookingGroupAction(booking.id);
    setPending(false);
    if (res.ok) onChanged();
    else setError(res.error);
  }

  const balanceMinor = booking.totalMinor - booking.amountPaidMinor;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal booking-operations-modal" onClick={(e) => e.stopPropagation()}>
        <span className="close" onClick={onClose}>
          [ ESC ]
        </span>
        <h3>
          Booking Operations <span className="dim mono" style={{ fontSize: 12 }}>{booking.reference}</span>
        </h3>
        <div className="booking-ops-meta">{booking.dateLabel}</div>

        <div className="settings-section-title">Customer Details</div>
        <div className="booking-customer-grid">
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
            <input value={booking.email} readOnly />
          </div>
          <div className="booking-customer-notes">
            <label>Notes</label>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <button className="btn secondary" style={{ marginTop: 10 }} onClick={saveDetails} disabled={pending}>
          Save Details
        </button>

        <div className="settings-section-title">Booking Summary</div>
        <div className="booking-ops-items">
          {booking.items.map((item, i) => (
            <div className="booking-item-line" key={i}>
              <span>
                {item.courtName} {formatTime(item.start)}–{formatTime(item.end)}
              </span>
              <span>
                {currency} {(item.priceMinor / 100).toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        <div className="settings-section-title">Amount Totals</div>
        <div className="booking-ops-summary">
          <div>
            Total
            <strong>
              {currency} {(booking.totalMinor / 100).toFixed(2)}
            </strong>
          </div>
          <div>
            Paid
            <strong>
              {currency} {(booking.amountPaidMinor / 100).toFixed(2)}
            </strong>
          </div>
          <div>
            Balance
            <strong>
              {currency} {(balanceMinor / 100).toFixed(2)}
            </strong>
          </div>
        </div>

        <div className="settings-section-title">Record New Payment</div>
        <div className="inline-form">
          <div>
            <label>Payment Amount</label>
            <input type="number" min={0} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="Enter payment received" />
          </div>
          <div>
            <label>Payment Method</label>
            <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as any)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button className="btn secondary block" style={{ marginTop: 10 }} onClick={recordPay} disabled={pending}>
          Record Payment
        </button>

        <div className="settings-section-title">Operations Status</div>
        <label>Booking Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className="btn secondary block" style={{ marginTop: 10 }} onClick={saveStatus} disabled={pending}>
          Update Status
        </button>

        {error && <div className="field-warning">{error}</div>}

        <button className="btn danger block" style={{ marginTop: 10 }} onClick={cancel} disabled={pending}>
          Cancel Booking
        </button>
      </div>
    </div>
  );
}
