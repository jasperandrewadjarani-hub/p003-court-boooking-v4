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
const PAYMENT_STATUS_OPTIONS = ["", "unpaid", "awaiting_verification", "partial", "paid", "refunded"];

const ANY_DISCOUNT = "__ANY__";
type SortField = "createdAt" | "customer" | "status" | "paymentStatus" | "amountPaid" | "total";

export function BookingsTable({ initialResult, currency, discountCodes = [] }: { initialResult: PagedBookings; currency: string; discountCodes?: string[] }) {
  const [result, setResult] = useState(initialResult);
  const [dateFrom, setDateFrom] = useState(""); // empty = all dates
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [discount, setDiscount] = useState(""); // "" = all, ANY_DISCOUNT = any, or a specific code
  const [hideFuture, setHideFuture] = useState(false); // only today & earlier
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminBookingGroup | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function fetchPage(targetPage: number) {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setRangeError('"From" date must be on or before the "To" date.');
      return;
    }
    setRangeError(null);
    startTransition(async () => {
      const r = await listBookingsAction({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, status: status || undefined, paymentStatus: paymentStatus || undefined, discountCode: discount || undefined, hideFuture: hideFuture || undefined, search: search || undefined, sortBy, sortDir, page: targetPage, pageSize: PAGE_SIZE });
      setResult(r);
      setPage(targetPage);
    });
  }

  // Click a sortable column header: toggle direction if it's the active column,
  // else switch to it (default descending).
  function toggleSort(field: SortField) {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(field); setSortDir("desc"); }
  }
  const sortArrow = (field: SortField) => (sortBy === field ? (sortDir === "asc" ? " ▲" : " ▼") : "");

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
  }, [dateFrom, dateTo, status, paymentStatus, discount, hideFuture, search, sortBy, sortDir, page]);

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
            <label>From (booking date)</label>
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
                  {s === "" ? "All" : labelize(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Payment</label>
            <select className="select-sm" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
              {PAYMENT_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "" ? "All" : labelize(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Discount</label>
            <select className="select-sm" value={discount} onChange={(e) => setDiscount(e.target.value)}>
              <option value="">All</option>
              <option value={ANY_DISCOUNT}>Any discount applied</option>
              {discountCodes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Timeframe</label>
            <label className="mono" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, textTransform: "none", cursor: "pointer", padding: "6px 0" }}>
              <input type="checkbox" style={{ width: "auto" }} checked={hideFuture} onChange={(e) => setHideFuture(e.target.checked)} />
              Hide future bookings
            </label>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Search (name / phone / ID)</label>
            <input type="text" className="input-sm" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className="btn secondary" onClick={applyFilters} disabled={isPending}>
            Filter
          </button>
          <button
            className="btn secondary"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setStatus("");
              setPaymentStatus("");
              setDiscount("");
              setHideFuture(false);
              setSearch("");
              setSortBy("createdAt");
              setSortDir("desc");
              setRangeError(null);
              startTransition(async () => {
                const r = await listBookingsAction({ page: 1, pageSize: PAGE_SIZE, sortBy: "createdAt", sortDir: "desc" });
                setResult(r);
                setPage(1);
              });
            }}
            disabled={isPending}
          >
            Clear
          </button>
        </div>
        {rangeError && <div className="field-warning">{rangeError}</div>}
        <p className="dim mono" style={{ fontSize: 11 }}>
          Click a booking row to expand its courts/time slots. A booking made across multiple courts shares one Booking ID.
        </p>
        <p className="dim mono" style={{ fontSize: 11, marginTop: -4 }}>Click a column header (↕) to sort.</p>
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID / Date</th>
              <th className="sortable-col" style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("createdAt")}>Made{sortArrow("createdAt")}{sortBy !== "createdAt" ? " ↕" : ""}</th>
              <th className="sortable-col" style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("customer")}>Customer{sortArrow("customer")}{sortBy !== "customer" ? " ↕" : ""}</th>
              <th className="sortable-col" style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("status")}>Status{sortArrow("status")}{sortBy !== "status" ? " ↕" : ""}</th>
              <th className="sortable-col" style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("paymentStatus")}>Payment{sortArrow("paymentStatus")}{sortBy !== "paymentStatus" ? " ↕" : ""}</th>
              <th className="sortable-col" style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("amountPaid")}>Amount Paid{sortArrow("amountPaid")}{sortBy !== "amountPaid" ? " ↕" : ""}</th>
              <th className="sortable-col" style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("total")}>Total{sortArrow("total")}{sortBy !== "total" ? " ↕" : ""}</th>
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
                    {b.discountCode && (
                      <span className="mono" style={{ marginLeft: 8, padding: "1px 6px", borderRadius: 6, fontSize: 10, background: "color-mix(in srgb, var(--accent-optic) 16%, transparent)", color: "var(--accent-optic)", whiteSpace: "nowrap" }}>
                        🏷 {b.discountCode} −{currency} {(b.discountAmountMinor / 100).toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td className="mono" style={{ whiteSpace: "nowrap", fontSize: 12 }}>{b.createdAtLabel}</td>
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
                    <td colSpan={8}>
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
                        {b.discountCode && (
                          <div className="booking-item-line" style={{ color: "var(--accent-optic)" }}>
                            <span>Discount · {b.discountCode}</span>
                            <span>
                              − {currency} {(b.discountAmountMinor / 100).toFixed(2)}
                            </span>
                          </div>
                        )}
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
