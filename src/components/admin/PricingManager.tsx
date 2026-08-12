"use client";

import { useState, useTransition } from "react";
import { listPriceMatrixAction, savePriceMatrixRowAction, deletePriceMatrixRowAction } from "@/app/admin/actions";
import type { PriceMatrixRow } from "@/generated/prisma/client";

const EMPTY = { dayType: "weekday" as "weekday" | "weekend", startTime: "06:00", endTime: "17:00", courtType: "indoor" as "indoor" | "outdoor", pricePerHourMinor: "" };

export function PricingManager({ initialRows }: { initialRows: PriceMatrixRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => setRows(await listPriceMatrixAction()));
  }

  function edit(row: PriceMatrixRow) {
    setEditingId(row.id);
    setForm({ dayType: row.dayType as any, startTime: row.startTime, endTime: row.endTime, courtType: row.courtType as any, pricePerHourMinor: String(row.pricePerHourMinor / 100) });
  }

  function clearForm() {
    setEditingId(null);
    setForm(EMPTY);
  }

  async function save() {
    setError(null);
    if (!form.pricePerHourMinor) {
      setError("Enter a price.");
      return;
    }
    const res = await savePriceMatrixRowAction(
      { dayType: form.dayType, startTime: form.startTime, endTime: form.endTime, courtType: form.courtType, pricePerHourMinor: Math.round(Number(form.pricePerHourMinor) * 100) },
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
        Price Matrix rules always take priority. A court&apos;s &quot;Base Rate/Hr&quot; is only used as a fallback when no matrix rule matches its day type + Indoor/Outdoor type.
      </p>
      <div className="panel">
        <div className="panel__title">{editingId ? "Edit Rule" : "Add Rule"}</div>
        <div className="inline-form">
          <div>
            <label>Day Type</label>
            <select value={form.dayType} onChange={(e) => setForm({ ...form, dayType: e.target.value as any })}>
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
            <label>Court Type</label>
            <select value={form.courtType} onChange={(e) => setForm({ ...form, courtType: e.target.value as any })}>
              <option value="indoor">Indoor</option>
              <option value="outdoor">Outdoor</option>
            </select>
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
              <th>Day Type</th>
              <th>Start</th>
              <th>End</th>
              <th>Court Type</th>
              <th>Price/Hr</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.dayType}</td>
                <td>{r.startTime}</td>
                <td>{r.endTime}</td>
                <td>{r.courtType}</td>
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
