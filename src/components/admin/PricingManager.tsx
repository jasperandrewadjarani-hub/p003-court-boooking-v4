"use client";

import { useState, useTransition } from "react";
import { listPriceMatrixAction, savePriceMatrixRowAction, deletePriceMatrixRowAction } from "@/app/admin/actions";
import type { PriceMatrixRowWithCourt } from "@/lib/admin/masterData";

interface CourtOption {
  id: string;
  code: string;
  name: string;
}

export function PricingManager({ initialRows, courts }: { initialRows: PriceMatrixRowWithCourt[]; courts: CourtOption[] }) {
  const EMPTY = {
    courtId: courts[0]?.id ?? "",
    dayType: "all" as "weekday" | "weekend" | "all",
    startTime: "06:00",
    endTime: "17:00",
    pricePerHourMinor: "",
  };
  const [rows, setRows] = useState(initialRows);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => setRows(await listPriceMatrixAction()));
  }

  function edit(row: PriceMatrixRowWithCourt) {
    setEditingId(row.id);
    setForm({ courtId: row.courtId ?? "", dayType: row.dayType as "weekday" | "weekend" | "all", startTime: row.startTime, endTime: row.endTime, pricePerHourMinor: String(row.pricePerHourMinor / 100) });
  }

  function clearForm() {
    setEditingId(null);
    setForm(EMPTY);
  }

  async function save() {
    setError(null);
    if (!form.courtId) {
      setError("Choose a court.");
      return;
    }
    if (!form.pricePerHourMinor) {
      setError("Enter a price.");
      return;
    }
    const res = await savePriceMatrixRowAction(
      { courtId: form.courtId, dayType: form.dayType, startTime: form.startTime, endTime: form.endTime, pricePerHourMinor: Math.round(Number(form.pricePerHourMinor) * 100) },
      editingId ?? undefined
    );
    if (res.ok) {
      clearForm();
      refresh();
    } else {
      setError(res.error);
    }
  }

  async function remove(id: string) {
    await deletePriceMatrixRowAction(id);
    refresh();
  }

  return (
    <div className="admin-view">
      <div className="admin-topbar">
        <h2>Price Matrix</h2>
      </div>
      <p className="dim mono" style={{ fontSize: 11 }}>
        Each rule prices ONE court for a day type + time window, so courts can be priced individually (surface, VIP, etc.). Use <strong>All Days</strong> when weekday and weekend rates are the same; a specific Weekday/Weekend rule overrides an All Days rule where they overlap. A court&apos;s &quot;Base Rate/Hr&quot; is the fallback when no rule matches.
      </p>
      <div className="panel">
        <div className="panel__title">{editingId ? "Edit Rule" : "Add Rule"}</div>
        <div className="inline-form">
          <div>
            <label>Court</label>
            <select value={form.courtId} onChange={(e) => setForm({ ...form, courtId: e.target.value })}>
              {courts.length === 0 && <option value="">No courts</option>}
              {courts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Day Type</label>
            <select value={form.dayType} onChange={(e) => setForm({ ...form, dayType: e.target.value as "weekday" | "weekend" | "all" })}>
              <option value="all">All Days</option>
              <option value="weekday">Weekday</option>
              <option value="weekend">Weekend</option>
            </select>
          </div>
          <div>
            <label>Start</label>
            <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
          </div>
          <div>
            <label>End</label>
            <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
          </div>
          <div>
            <label>Price / Hour</label>
            <input type="number" value={form.pricePerHourMinor} onChange={(e) => setForm({ ...form, pricePerHourMinor: e.target.value })} />
          </div>
        </div>
        {error && <div className="field-warning">{error}</div>}
        <button className="btn" style={{ marginTop: 14 }} onClick={save} disabled={isPending}>
          Save Rule
        </button>
        <button className="btn secondary" style={{ marginTop: 14, marginLeft: 8 }} onClick={clearForm}>
          New Rule
        </button>
      </div>
      <div className="panel">
        <div className="panel__title">Current Rules</div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Court</th>
              <th>Day Type</th>
              <th>Start</th>
              <th>End</th>
              <th>Price/Hr</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.courtName}</td>
                <td>{r.dayType === "all" ? "All Days" : r.dayType}</td>
                <td>{r.startTime}</td>
                <td>{r.endTime}</td>
                <td>{(r.pricePerHourMinor / 100).toFixed(2)}</td>
                <td className="action-cell">
                  <button className="btn secondary" onClick={() => edit(r)}>
                    Edit
                  </button>
                  <button className="btn danger" onClick={() => remove(r.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
