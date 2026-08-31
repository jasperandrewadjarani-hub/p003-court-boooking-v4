"use client";

import { useEffect, useState, useTransition } from "react";
import { listDiscountsAction, saveDiscountAction, deleteDiscountAction } from "@/app/admin/actions";

type DiscountType = "percentage" | "fixed_php" | "fixed_php_per_slot";

interface DiscountRow {
  id: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  maxAvailments: number;
  maxTotalDiscountMinor: number;
  totalDiscountedMinor: number;
  timesAvailed: number;
  active: boolean;
}

// Both peso types are entered in pesos and stored as minor units (centavos);
// percentage is stored as-is.
const isPesoType = (t: DiscountType) => t === "fixed_php" || t === "fixed_php_per_slot";
const typeLabel = (t: DiscountType) => (t === "percentage" ? "Percentage" : t === "fixed_php_per_slot" ? "PHP per Slot" : "Fixed PHP");

const EMPTY = { code: "", discountType: "percentage" as DiscountType, discountValue: "0", maxAvailments: "0", maxTotalDiscount: "0", active: true };

/** v3b "Discounts" sub-panel of the Memberships and Discounts screen. */
export function DiscountsManager() {
  const [rows, setRows] = useState<DiscountRow[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => setRows((await listDiscountsAction()) as DiscountRow[]));
  }
  useEffect(() => {
    refresh();
  }, []);

  function edit(d: DiscountRow) {
    setForm({
      code: d.code,
      discountType: d.discountType,
      discountValue: String(isPesoType(d.discountType) ? d.discountValue / 100 : d.discountValue),
      maxAvailments: String(d.maxAvailments),
      maxTotalDiscount: String((d.maxTotalDiscountMinor ?? 0) / 100),
      active: d.active,
    });
  }

  async function save() {
    setError(null);
    if (!form.code.trim()) {
      setError("Discount code is required.");
      return;
    }
    const rawValue = Number(form.discountValue);
    const res = await saveDiscountAction({
      code: form.code,
      discountType: form.discountType,
      // Peso types are entered in pesos, stored as minor units; percentage stored as-is.
      discountValue: isPesoType(form.discountType) ? Math.round(rawValue * 100) : rawValue,
      maxAvailments: Number(form.maxAvailments),
      maxTotalDiscountMinor: Math.round(Number(form.maxTotalDiscount) * 100),
      active: form.active,
    });
    if (res.ok) {
      setForm(EMPTY);
      refresh();
    } else {
      setError(res.error);
    }
  }

  async function remove(id: string, code: string) {
    if (!window.confirm(`Delete discount code "${code}"? This cannot be undone.`)) return;
    const res = await deleteDiscountAction(id);
    if (res.ok) refresh();
    else setError(res.error);
  }

  return (
    <>
      <div className="panel">
        <div className="panel__title">Discounts</div>
        <div className="inline-form">
          <div>
            <label>Code</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </div>
          <div>
            <label>Type</label>
            <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as DiscountType })}>
              <option value="percentage">Percentage</option>
              <option value="fixed_php">Fixed PHP</option>
              <option value="fixed_php_per_slot">PHP per Slot (per booked hour)</option>
            </select>
          </div>
          <div>
            <label>Value {form.discountType === "percentage" ? "(%)" : form.discountType === "fixed_php_per_slot" ? "(PHP/slot)" : "(PHP)"}</label>
            <input type="number" min={0} value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} />
          </div>
          <div>
            <label>Maximum Availments (0 = unlimited)</label>
            <input type="number" min={0} value={form.maxAvailments} onChange={(e) => setForm({ ...form, maxAvailments: e.target.value })} />
          </div>
          <div>
            <label>Max Total Discount (PHP, 0 = unlimited)</label>
            <input type="number" min={0} value={form.maxTotalDiscount} onChange={(e) => setForm({ ...form, maxTotalDiscount: e.target.value })} />
          </div>
          <div>
            <label>Status</label>
            <select value={form.active ? "TRUE" : "FALSE"} onChange={(e) => setForm({ ...form, active: e.target.value === "TRUE" })}>
              <option value="TRUE">Active</option>
              <option value="FALSE">Inactive</option>
            </select>
          </div>
        </div>
        {error && <div className="field-warning">{error}</div>}
        <button className="btn" style={{ marginTop: 14 }} onClick={save}>
          Save Discount
        </button>
        <button className="btn secondary" style={{ marginTop: 14, marginLeft: 8 }} onClick={() => setForm(EMPTY)}>
          New Discount
        </button>
      </div>
      <div className="panel">
        <div className="panel__title">All Discounts</div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Type</th>
              <th>Value</th>
              <th>Used</th>
              <th>Maximum</th>
              <th>Total Given / Budget</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>{d.code}</td>
                <td>{typeLabel(d.discountType)}</td>
                <td>
                  {d.discountType === "percentage"
                    ? `${d.discountValue}%`
                    : `PHP ${(d.discountValue / 100).toFixed(2)}${d.discountType === "fixed_php_per_slot" ? "/slot" : ""}`}
                </td>
                <td>{d.timesAvailed}</td>
                <td>{d.maxAvailments === 0 ? "Unlimited" : d.maxAvailments}</td>
                <td>
                  PHP {((d.totalDiscountedMinor ?? 0) / 100).toFixed(2)}
                  {" / "}
                  {(d.maxTotalDiscountMinor ?? 0) === 0 ? "Unlimited" : `PHP ${((d.maxTotalDiscountMinor ?? 0) / 100).toFixed(2)}`}
                </td>
                <td>
                  <span className={`badge ${d.active ? "on" : "off"}`}>{d.active ? "Active" : "Inactive"}</span>
                </td>
                <td className="action-cell">
                  <button className="btn secondary" onClick={() => edit(d)}>
                    Edit
                  </button>
                  <button className="btn danger" onClick={() => remove(d.id, d.code)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
