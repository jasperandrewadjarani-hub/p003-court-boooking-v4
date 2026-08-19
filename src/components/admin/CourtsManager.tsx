"use client";

import { useState, useTransition } from "react";
import { listCourtsAction, saveCourtAction, deleteCourtAction } from "@/app/admin/actions";
import type { Court } from "@/generated/prisma/client";

const EMPTY: any = { code: "", name: "", indoor: true, status: "available", surface: "", lighting: "", capacity: 4, airConditioned: false, baseRateMinor: "", lightingFeeMinor: "", description: "", imageUrl: "", headerColor: "" };
const MAX_UPLOAD_BYTES = 1_400_000;

export function CourtsManager({ initialCourts }: { initialCourts: Court[] }) {
  const [courts, setCourts] = useState(initialCourts);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => setCourts(await listCourtsAction()));
  }

  function edit(court: Court) {
    setForm({
      code: court.code,
      name: court.name,
      indoor: court.indoor,
      status: court.status,
      surface: court.surface ?? "",
      lighting: court.lighting ?? "",
      capacity: court.capacity,
      airConditioned: court.airConditioned,
      baseRateMinor: court.baseRateMinor !== null ? court.baseRateMinor / 100 : "",
      lightingFeeMinor: court.lightingFeeMinor !== null ? court.lightingFeeMinor / 100 : "",
      description: court.description ?? "",
      imageUrl: court.imageUrl ?? "",
      headerColor: court.headerColor ?? "",
    });
  }

  function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Court photo must be an image file.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`Image is too large (${(file.size / 1024 / 1024).toFixed(1)}MB) — please use one under 1.4MB.`);
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setForm((f: any) => ({ ...f, imageUrl: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  async function save() {
    setError(null);
    if (!form.code) {
      setError("Court ID is required.");
      return;
    }
    const res = await saveCourtAction({
      code: form.code,
      name: form.name,
      indoor: form.indoor,
      status: form.status,
      surface: form.surface || undefined,
      lighting: form.lighting || undefined,
      capacity: Number(form.capacity),
      airConditioned: form.airConditioned,
      baseRateMinor: form.baseRateMinor !== "" ? Math.round(Number(form.baseRateMinor) * 100) : undefined,
      lightingFeeMinor: form.lightingFeeMinor !== "" ? Math.round(Number(form.lightingFeeMinor) * 100) : undefined,
      description: form.description || undefined,
      imageUrl: form.imageUrl || null,
      headerColor: form.headerColor || null,
    });
    if (res.ok) {
      setForm(EMPTY);
      refresh();
    } else {
      setError(res.error);
    }
  }

  async function remove(courtId: string) {
    await deleteCourtAction(courtId);
    refresh();
  }

  return (
    <div className="admin-view">
      <div className="admin-topbar">
        <h2>Courts</h2>
      </div>
      <div className="panel">
        <div className="panel__title">Add / Edit Court</div>
        <p className="dim mono" style={{ fontSize: 11, marginTop: -8 }}>
          Add a new court by entering a fresh Court ID (e.g. CRT-4) and saving.
        </p>
        <div className="inline-form">
          <div>
            <label>Court ID</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div>
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label>Indoor</label>
            <select value={form.indoor ? "TRUE" : "FALSE"} onChange={(e) => setForm({ ...form, indoor: e.target.value === "TRUE" })}>
              <option>TRUE</option>
              <option>FALSE</option>
            </select>
          </div>
          <div>
            <label>Status</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="available">available</option>
              <option value="maintenance">maintenance</option>
              <option value="closed">closed</option>
            </select>
          </div>
          <div>
            <label>Surface</label>
            <input value={form.surface} onChange={(e) => setForm({ ...form, surface: e.target.value })} />
          </div>
          <div>
            <label>Lighting</label>
            <input value={form.lighting} onChange={(e) => setForm({ ...form, lighting: e.target.value })} />
          </div>
          <div>
            <label>Capacity (players)</label>
            <input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
          </div>
          <div>
            <label>Air Conditioned</label>
            <select value={form.airConditioned ? "TRUE" : "FALSE"} onChange={(e) => setForm({ ...form, airConditioned: e.target.value === "TRUE" })}>
              <option>TRUE</option>
              <option>FALSE</option>
            </select>
          </div>
          <div>
            <label>Base Rate/Hr (fallback only)</label>
            <input type="number" value={form.baseRateMinor} onChange={(e) => setForm({ ...form, baseRateMinor: e.target.value })} />
          </div>
          <div>
            <label>Lighting Fee</label>
            <input type="number" value={form.lightingFeeMinor} onChange={(e) => setForm({ ...form, lightingFeeMinor: e.target.value })} />
          </div>
          <div className="court-description-field">
            <label>Description</label>
            <input placeholder="e.g. Silica, Building 1" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
        <div className="settings-grid" style={{ marginTop: 12 }}>
          <div className="settings-field">
            <label>Court Photo (shown to customers)</label>
            <input type="file" accept="image/*" onChange={pickImage} />
          </div>
          <div className="settings-field">
            <label>Photo Preview</label>
            {form.imageUrl ? (
              <>
                <div className="settings-image-preview">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={form.imageUrl} alt="Court preview" />
                </div>
                <button type="button" className="dim mono" style={{ marginTop: 6, background: "none", border: "none", textDecoration: "underline", cursor: "pointer", fontSize: 11, padding: 0, textAlign: "left" }} onClick={() => setForm({ ...form, imageUrl: "" })}>
                  Remove photo
                </button>
              </>
            ) : (
              <span className="dim mono" style={{ fontSize: 11 }}>No photo uploaded</span>
            )}
          </div>
          <div className="settings-field">
            <label>Header Label Color (customer + admin grids)</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="color"
                style={{ width: 40, padding: 2 }}
                value={/^#[0-9A-Fa-f]{6}$/.test(form.headerColor) ? form.headerColor : "#C6FF3D"}
                onChange={(e) => setForm({ ...form, headerColor: e.target.value.toUpperCase() })}
              />
              <input value={form.headerColor} onChange={(e) => setForm({ ...form, headerColor: e.target.value.toUpperCase() })} placeholder="Default (green / cyan)" />
            </div>
            {form.headerColor && (
              <button type="button" className="dim mono" style={{ marginTop: 6, background: "none", border: "none", textDecoration: "underline", cursor: "pointer", fontSize: 11, padding: 0, textAlign: "left" }} onClick={() => setForm({ ...form, headerColor: "" })}>
                Use default color
              </button>
            )}
          </div>
        </div>
        {error && <div className="field-warning">{error}</div>}
        <button className="btn" style={{ marginTop: 14 }} onClick={save} disabled={isPending}>
          Save Court
        </button>
      </div>
      <div className="panel">
        <div className="panel__title">All Courts</div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Description</th>
              <th>Indoor</th>
              <th>Status</th>
              <th>Capacity</th>
              <th>Rate/Hr</th>
              <th>Header Color</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {courts.map((c) => (
              <tr key={c.id}>
                <td>{c.code}</td>
                <td>{c.name}</td>
                <td>{c.description}</td>
                <td>{c.indoor ? "TRUE" : "FALSE"}</td>
                <td>{c.status}</td>
                <td>{c.capacity}</td>
                <td>{c.baseRateMinor !== null ? (c.baseRateMinor / 100).toFixed(2) : "—"}</td>
                <td>
                  {c.headerColor ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: c.headerColor, border: "1px solid var(--line-grid)" }} />
                      <span className="mono dim" style={{ fontSize: 11 }}>{c.headerColor}</span>
                    </span>
                  ) : (
                    <span className="dim mono" style={{ fontSize: 11 }}>Default</span>
                  )}
                </td>
                <td className="action-cell">
                  <button className="btn secondary" onClick={() => edit(c)}>
                    Edit
                  </button>
                  <button className="btn danger" onClick={() => remove(c.id)}>
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
