"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { listBookingsAction } from "@/app/admin/actions";
import { BookingOperationsModal } from "@/components/admin/BookingOperationsModal";
import type { AdminBookingGroup, PagedBookings } from "@/lib/admin/bookings";
import { labelize } from "@/lib/format";

const PAGE_SIZE = 20;
// Live update every 20s (v3b's own dispatch-grid poll cadence) so a newly
// received booking shows up without a manual refresh.
const POLL_MS = 20_000;

// v3b's status vocabulary is wider (checked_in/playing/finished/no_show) for
// possible future front-desk flows, but nothing in this deployment ever
// writes those — client asked to trim the admin-facing UI to just the four
// states that are actually used, not touch the underlying schema/enum.
const STATUS_OPTIONS = ["", "reserved", "confirmed", "cancelled", "lapsed"];

export function BookingsTable({ initialResult, currency }: { initialResult: PagedBookings; currency: string }) {
  const [result, setResult] = useState(initialResult);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminBookingGroup | null>(null);
  const [isPending, startTransition] = useTransition();

  function fetchPage(targetPage: number) {
    startTransition(async () => {
      const r = await listBookingsAction({ status: status || undefined, search: search || undefined, page: targetPage, pageSize: PAGE_SIZE });
      setResult(r);
      setPage(targetPage);
    });
  }

  function applyFilters() {
    fetchPage(1); // any filter change starts back at page 1
  }

  // Quiet background refresh — re-fetches the current page/filters without
  // disturbing scroll position or an open modal (a booking being managed
  // isn't affected; BookingOperationsModal holds its own copy).
  useEffect(() => {
    const id = setInterval(() => fetchPage(page), POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search, page]);

  const bookings = result.items;
  const totalPages = Math.max(1, Math.ceil(result.totalCount / result.pageSize));
  const rangeStart = result.totalCount === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const rangeEnd = Math.min(result.page * result.pageSize, result.totalCount);

  return (
    <div className="admin-view">
      <div className="admin-topbar">
        <h2>Bookings</h2>
      </div>
      <div className="panel">
        <div className="admin-toolbar">
          <div className="field">
            <label>Status</label>
            <select className="select-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "" ? "All" : labelize(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Search (name / phone / ID)</label>
            <input type="text" className="input-sm" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className="btn secondary" onClick={applyFilters} disabled={isPending}>
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
                  <td>{labelize(b.status)}</td>
                  <td>{labelize(b.paymentStatus)}</td>
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

        <div className="admin-pagination">
          <span className="dim mono" style={{ fontSize: 11 }}>
            {result.totalCount === 0 ? "No bookings" : `Showing ${rangeStart}–${rangeEnd} of ${result.totalCount.toLocaleString()} bookings`}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn secondary" onClick={() => fetchPage(page - 1)} disabled={isPending || page <= 1}>
              ← Prev
            </button>
            <span className="dim mono" style={{ fontSize: 11, alignSelf: "center" }}>
              Page {page} of {totalPages}
            </span>
            <button className="btn secondary" onClick={() => fetchPage(page + 1)} disabled={isPending || page >= totalPages}>
              Next →
            </button>
          </div>
        </div>
      </div>

      {editing && (
        <BookingOperationsModal
          booking={editing}
          currency={currency}
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null);
            fetchPage(page);
          }}
          onSilentRefresh={() => fetchPage(page)}
        />
      )}
    </div>
  );
}
