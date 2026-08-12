"use client";

import { Fragment, useState, useTransition } from "react";
import { listBookingsAction } from "@/app/admin/actions";
import { BookingOperationsModal } from "@/components/admin/BookingOperationsModal";
import type { AdminBookingGroup } from "@/lib/admin/bookings";

const STATUS_OPTIONS = ["", "reserved", "confirmed", "checked_in", "playing", "finished", "cancelled", "lapsed", "no_show"];

export function BookingsTable({ initialBookings, currency }: { initialBookings: AdminBookingGroup[]; currency: string }) {
  const [bookings, setBookings] = useState(initialBookings);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminBookingGroup | null>(null);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      const result = await listBookingsAction({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, status: status || undefined, search: search || undefined });
      setBookings(result);
    });
  }

  return (
    <div className="admin-view">
      <div className="admin-topbar">
        <h2>Bookings</h2>
      </div>
      <div className="panel">
        <div className="admin-toolbar">
          <div className="field">
            <label>From</label>
            <input type="date" className="input-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" className="input-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="field">
            <label>Status</label>
            <select className="select-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "" ? "All" : s}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Search (name / phone / ID)</label>
            <input type="text" className="input-sm" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className="btn secondary" onClick={refresh} disabled={isPending}>
            Filter
          </button>
        </div>
        <p className="dim mono" style={{ fontSize: 11 }}>
          Click a booking row to expand its courts/time slots. A booking made across multiple courts shares one Booking ID.
        </p>
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID / Date</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Amount Paid</th>
              <th>Total</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => (
              <Fragment key={b.id}>
                <tr className="booking-group-row" onClick={() => setExpanded(expanded === b.id ? null : b.id)}>
                  <td>
                    <span className={`expand-caret ${expanded === b.id ? "open" : ""}`}>▶</span>
                    {b.reference ?? "Pending"} · {b.dateLabel}
                  </td>
                  <td>{b.customerName}</td>
                  <td>{b.status}</td>
                  <td>{b.paymentStatus}</td>
                  <td>
                    {currency} {(b.amountPaidMinor / 100).toFixed(2)}
                  </td>
                  <td>
                    {currency} {(b.totalMinor / 100).toFixed(2)}
                  </td>
                  <td className="action-cell">
                    <button
                      className="btn secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(b);
                      }}
                    >
                      Manage
                    </button>
                  </td>
                </tr>
                {expanded === b.id && (
                  <tr className="booking-items-row">
                    <td colSpan={7}>
                      <div className="booking-items-inner">
                        {b.items.map((item, i) => (
                          <div className="booking-item-line" key={i}>
                            <span>
                              {item.courtName} {item.start}–{item.end}
                            </span>
                            <span>
                              {currency} {(item.priceMinor / 100).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <BookingOperationsModal
          booking={editing}
          currency={currency}
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
