"use client";

import { useState, useTransition } from "react";
import { listMembershipsAdminAction, saveMembershipAction } from "@/app/admin/actions";
import type { Membership } from "@/generated/prisma/client";

const EMPTY = { name: "", monthlyFeeMinor: "0", discountPercent: "0", priorityBooking: false, freeHoursMonth: "0", active: true };

export function MembershipsManager({ initialMemberships }: { initialMemberships: Membership[] }) {
  const [memberships, setMemberships] = useState(initialMemberships);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => setMemberships(await listMembershipsAdminAction()));
  }

  function edit(m: Membership) {
    setForm({
      name: m.name,
      monthlyFeeMinor: String(m.monthlyFeeMinor / 100),
      discountPercent: String(m.discountPercent),
      priorityBooking: m.priorityBooking,
      freeHoursMonth: String(m.freeHoursMonth),
      active: m.active,
    });
  }

  async function save() {
    setError(null);
    if (!form.name) {
      setError("Membership name is required.");
      return;
    }
    const res = await saveMembershipAction({
      name: form.name,
      monthlyFeeMinor: Math.round(Number(form.monthlyFeeMinor) * 100),
      discountPercent: Number(form.discountPercent),
      priorityBooking: form.priorityBooking,
      freeHoursMonth: Number(form.freeHoursMonth),
      active: form.active,
    });
    if (res.ok) {
      setForm(EMPTY);
      refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <div className="admin-view">
      <div className="admin-topbar">
        <h2>Memberships</h2>
      </div>
      <div className="panel">
        <div className="panel__title">Add / Edit Membership</div>
        <div className="inline-form">
          <div>
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label>Monthly Fee</label>
            <input type="number" value={form.monthlyFeeMinor} onChange={(e) => setForm({ ...form, monthlyFeeMinor: e.target.value })} />
          </div>
          <div>
            <label>Discount %</label>
            <input type="number" value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: e.target.value })} />
          </div>
          <div>
            <label>Priority Booking</label>
            <select value={form.priorityBooking ? "TRUE" : "FALSE"} onChange={(e) => setForm({ ...form, priorityBooking: e.target.value === "TRUE" })}>
              <option>FALSE</option>
              <option>TRUE</option>
            </select>
          </div>
          <div>
            <label>Free Hours/Month</label>
            <input type="number" value={form.freeHoursMonth} onChange={(e) => setForm({ ...form, freeHoursMonth: e.target.value })} />
          </div>
          <div>
            <label>Status</label>
            <select value={form.active ? "TRUE" : "FALSE"} onChange={(e) => setForm({ ...form, active: e.target.value === "TRUE" })}>
              <option>TRUE</option>
              <option>FALSE</option>
            </select>
          </div>
        </div>
        {error && <div className="field-warning">{error}</div>}
        <button className="btn" style={{ marginTop: 14 }} onClick={save} disabled={isPending}>
          Save Membership
        </button>
        <button className="btn secondary" style={{ marginTop: 14, marginLeft: 8 }} onClick={() => setForm(EMPTY)}>
          New Membership
        </button>
      </div>
      <div className="panel">
        <div className="panel__title">All Memberships</div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Fee</th>
              <th>Discount</th>
              <th>Priority</th>
              <th>Free Hrs</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {memberships.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{(m.monthlyFeeMinor / 100).toFixed(2)}</td>
                <td>{Number(m.discountPercent)}%</td>
                <td>{m.priorityBooking ? "TRUE" : "FALSE"}</td>
                <td>{Number(m.freeHoursMonth)}</td>
                <td>
                  <span className={`badge ${m.active ? "on" : "off"}`}>{m.active ? "Active" : "Inactive"}</span>
                </td>
                <td className="action-cell">
                  <button className="btn secondary" onClick={() => edit(m)}>
                    Edit
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
