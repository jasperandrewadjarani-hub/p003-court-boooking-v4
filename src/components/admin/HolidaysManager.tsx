"use client";

import { useState, useTransition } from "react";
import { listHolidaysAction, saveHolidayAction, deleteHolidayAction } from "@/app/admin/actions";
import type { Holiday } from "@/generated/prisma/client";

const EMPTY = { date: "", name: "", rateMultiplier: "1.5" };

export function HolidaysManager({ initialHolidays }: { initialHolidays: Holiday[] }) {
  const [holidays, setHolidays] = useState(initialHolidays);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => setHolidays(await listHolidaysAction()));
  }

  async function save() {
    setError(null);
    if (!form.date || !form.name) {
      setError("Date and name are required.");
      return;
    }
    const res = await saveHolidayAction({ date: form.date, name: form.name, rateMultiplier: Number(form.rateMultiplier) });
    if (res.ok) {
      setForm(EMPTY);
      refresh();
    } else {
      setError(res.error);
    }
  }

  async function remove(id: string) {
    await deleteHolidayAction(id);
    refresh();
  }

  return (
    <div className="admin-view">
      <div className="admin-topbar">
        <h2>Holidays</h2>
      </div>
      <div className="panel">
        <div className="panel__title">Add Holiday</div>
        <div className="inline-form">
          <div>
            <label>Date</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label>Rate Multiplier</label>
            <input type="number" step="0.1" value={form.rateMultiplier} onChange={(e) => setForm({ ...form, rateMultiplier: e.target.value })} />
          </div>
        </div>
        {error && <div className="field-warning">{error}</div>}
        <button className="btn" style={{ marginTop: 14 }} onClick={save} disabled={isPending}>
          Add Holiday
        </button>
      </div>
      <div className="panel">
        <div className="panel__title">Upcoming / Recorded Holidays</div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Name</th>
              <th>Multiplier</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {holidays.map((h) => (
              <tr key={h.id}>
                <td>{h.date.toISOString().slice(0, 10)}</td>
                <td>{h.name}</td>
                <td>{Number(h.rateMultiplier)}x</td>
                <td className="action-cell">
                  <button className="btn danger" onClick={() => remove(h.id)}>
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
