"use client";

import { useEffect, useRef, useState } from "react";
import { updateBookingGroupAction, recordPaymentAction, updateBookingStatusAction, cancelBookingGroupAction, getBookingGroupAction } from "@/app/admin/actions";
import type { AdminBookingGroup } from "@/lib/admin/bookings";
import { labelize, formatMoney } from "@/lib/format";

const PAYMENT_METHODS = ["cash", "gcash", "maya", "gotyme", "credit_card", "bank_transfer"] as const;
// v3b's status vocabulary is wider (checked_in/playing/finished/no_show) for
// possible future front-desk flows, but nothing in this deployment ever
// writes those — client asked to trim the admin-facing UI to just the four
// states actually used. The underlying schema/enum is untouched.
const STATUSES = ["reserved", "confirmed", "cancelled", "lapsed"] as const;

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
}

/** Matches v2's Edit Booking modal — contact/notes edit, payment ledger,
 * status transitions, cancel. Court/date/time are intentionally not
 * editable here (cancel and rebook instead).
 *
 * onChanged: booking is done being managed — close the modal AND refresh the
 * parent's list (Save Details, Cancel Booking).
 * onSilentRefresh: something changed but the admin is probably still working
 * in this modal — refresh the parent's background list WITHOUT closing
 * (Record Payment, Update Status; client asked these to stay open with an
 * inline confirmation instead of exiting the form). */
export function BookingOperationsModal({
  booking: initialBooking,
  currency,
  onClose,
  onChanged,
  onSilentRefresh,
}: {
  booking: AdminBookingGroup;
  currency: string;
  onClose: () => void;
  onChanged: () => void;
  onSilentRefresh?: () => void;
}) {
  const [booking, setBooking] = useState(initialBooking);
  const [firstName, lastName] = booking.customerName.split(" ", 2);
  const [form, setForm] = useState({ firstName: firstName ?? "", lastName: lastName ?? "", phone: booking.phone ?? "", notes: booking.notes ?? "" });
  // Left empty so the outstanding balance shows as gray placeholder text
  // (client asked for a hint, not a pre-filled editable value) — leaving the
  // box blank on submit falls back to that same balance amount.
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<(typeof PAYMENT_METHODS)[number]>("cash");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>(
    (STATUSES as readonly string[]).includes(booking.status) ? (booking.status as (typeof STATUSES)[number]) : "reserved"
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Guards against the backdrop closing the modal when a mouse-drag text
  // selection that STARTED inside the modal happens to release outside it
  // (a plain onClick={onClose} on the backdrop fires in that case too,
  // since the click's target is wherever the mouse came up) — only close
  // when both the mousedown AND the click landed directly on the backdrop.
  const mouseDownOnBackdrop = useRef(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Re-pulls this one booking's fresh data after a payment/status change so
  // the Amount Totals / Status dropdown reflect it without closing the modal.
  async function refetchInPlace() {
    const fresh = await getBookingGroupAction(booking.id);
    if (fresh) setBooking(fresh);
    onSilentRefresh?.();
  }

  async function saveDetails() {
    setPending(true);
    setError(null);
    setNotice(null);
    const res = await updateBookingGroupAction(booking.id, { firstName: form.firstName, lastName: form.lastName, mobileNumber: form.phone, notes: form.notes });
    setPending(false);
    if (res.ok) onChanged();
    else setError(res.error);
  }

  async function recordPay() {
    // Blank box = accept the placeholder's suggested amount (the current
    // outstanding balance), matching what the admin sees on screen.
    const balance = booking.totalMinor - booking.amountPaidMinor;
    const raw = payAmount.trim() !== "" ? payAmount : balance > 0 ? (balance / 100).toFixed(2) : "";
    const amountMinor = Math.round(Number(raw) * 100);
    if (!amountMinor || amountMinor <= 0) {
      setError("Enter a valid payment amount.");
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    const res = await recordPaymentAction(booking.id, payMethod, amountMinor);
    setPending(false);
    if (res.ok) {
      setNotice("✓ Payment recorded.");
      await refetchInPlace();
    } else {
      setError(res.error);
    }
  }

  async function saveStatus() {
    setPending(true);
    setError(null);
    setNotice(null);
    const res = await updateBookingStatusAction(booking.id, status);
    setPending(false);
    if (res.ok) {
      setNotice("✓ Booking status updated.");
      await refetchInPlace();
    } else {
      setError(res.error);
    }
  }

  async function cancel() {
    if (!window.confirm("Cancel this booking? This cannot be undone.")) return;
    setPending(true);
    setError(null);
    const res = await cancelBookingGroupAction(booking.id);
    setPending(false);
    if (res.ok) onChanged();
    else setError(res.error);
  }

  const balanceMinor = booking.totalMinor - booking.amountPaidMinor;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        mouseDownOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (mouseDownOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
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
                {currency} {formatMoney(item.priceMinor)}
              </span>
            </div>
          ))}
        </div>

        <div className="settings-section-title">Amount Totals</div>
        <div className="booking-ops-summary">
          <div>
            Total
            <strong>
              {currency} {formatMoney(booking.totalMinor)}
            </strong>
          </div>
          <div>
            Paid
            <strong>
              {currency} {formatMoney(booking.amountPaidMinor)}
            </strong>
          </div>
          <div>
            Balance
            <strong>
              {currency} {formatMoney(balanceMinor)}
            </strong>
          </div>
        </div>

        <div className="settings-section-title booking-receipt-row">
          <span>Payment Receipt</span>
          {booking.receiptId ? (
            <a className="btn secondary" href={`/api/receipts/${booking.receiptId}`} target="_blank" rel="noopener noreferrer">
              View Receipt
            </a>
          ) : (
            <span className="dim mono" style={{ fontSize: 11, textTransform: "none", letterSpacing: 0 }}>No receipt uploaded</span>
          )}
        </div>

        <div className="settings-section-title">Record New Payment</div>
        <div className="inline-form">
          <div>
            <label>Payment Amount</label>
            <input
              type="number"
              min={0}
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              placeholder={balanceMinor > 0 ? (balanceMinor / 100).toFixed(2) : "Enter payment received"}
            />
          </div>
          <div>
            <label>Payment Method</label>
            <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as any)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {labelize(m)}
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
              {labelize(s)}
            </option>
          ))}
        </select>
        <button className="btn secondary block" style={{ marginTop: 10 }} onClick={saveStatus} disabled={pending}>
          Update Status
        </button>

        {notice && <div className="receipt-state uploaded" style={{ marginTop: 10 }}>{notice}</div>}
        {error && <div className="field-warning">{error}</div>}

        <button className="btn danger block" style={{ marginTop: 10 }} onClick={cancel} disabled={pending}>
          Cancel Booking
        </button>
        <button className="btn secondary block" style={{ marginTop: 10 }} onClick={onClose}>
          Close Manage Booking Form
        </button>
      </div>
    </div>
  );
}
