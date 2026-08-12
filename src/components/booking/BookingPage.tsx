"use client";

import { useState, useTransition } from "react";
import { fetchGridAction, createBookingAction } from "@/app/actions";
import type { AvailabilityGrid } from "@/lib/booking/availability";

interface TenantInfo {
  name: string;
  slug: string;
  currency: string;
  primaryColor: string;
  accentColor: string;
}

interface SelectedSlot {
  courtId: string;
  courtName: string;
  start: string;
  end: string;
}

function todayKey(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Deliberately not toLocaleDateString(): its output depends on the ICU/Intl
// data available in the runtime, which differs between the Node.js server
// (SSR) and the browser (hydration) even with the same `undefined` locale
// argument — a real bug hit while testing this slice (server rendered
// "Wed 12 Aug", client rendered "Wed, 12 Aug", React discarded and
// re-rendered the whole tree). A fixed lookup table is deterministic.
function formatDateChip(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]} ${d} ${MONTHS[m - 1]}`;
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
}

export function BookingPage({ tenant, initialGrid }: { tenant: TenantInfo; initialGrid: AvailabilityGrid }) {
  const [dateKey, setDateKey] = useState(initialGrid.date);
  const [grid, setGrid] = useState(initialGrid);
  const [selected, setSelected] = useState<SelectedSlot | null>(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", players: 2 });
  const [status, setStatus] = useState<{ kind: "idle" | "success" | "error"; message?: string; reference?: string; totalMinor?: number }>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function loadDate(key: string) {
    setDateKey(key);
    setSelected(null);
    startTransition(async () => {
      const data = await fetchGridAction(key);
      setGrid(data);
    });
  }

  function onSlotClick(courtId: string, courtName: string, start: string, end: string) {
    setSelected({ courtId, courtName, start, end });
    setStatus({ kind: "idle" });
  }

  function submitBooking() {
    if (!selected) return;
    if (!form.firstName || !form.lastName || !form.email || !form.phone) {
      setStatus({ kind: "error", message: "Fill in all fields." });
      return;
    }
    startTransition(async () => {
      const res = await createBookingAction({
        dateKey,
        courtId: selected.courtId,
        startTime: selected.start,
        endTime: selected.end,
        players: form.players,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
      });
      if (res.ok) {
        setStatus({ kind: "success", reference: res.result.reference, totalMinor: res.result.totalMinor });
        setSelected(null);
        const fresh = await fetchGridAction(dateKey);
        setGrid(fresh);
      } else {
        setStatus({ kind: "error", message: res.error });
      }
    });
  }

  const dateButtons = Array.from({ length: 7 }, (_, i) => todayKey(i));

  return (
    <main className="min-h-screen p-4 md:p-8" style={{ ["--tenant-primary" as string]: tenant.primaryColor, ["--tenant-accent" as string]: tenant.accentColor }}>
      <header className="mb-6">
        <h1 className="text-3xl font-bold" style={{ color: "var(--tenant-primary)" }}>{tenant.name}</h1>
        <p className="text-sm opacity-60 font-mono">
          Test slice — no login yet, courts book instantly by email. Not the final booking flow.
        </p>
      </header>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {dateButtons.map((key) => (
          <button
            key={key}
            onClick={() => loadDate(key)}
            className="px-3 py-2 rounded text-sm font-mono whitespace-nowrap border"
            style={{
              borderColor: key === dateKey ? "var(--tenant-primary)" : "var(--line-grid)",
              background: key === dateKey ? "var(--tenant-primary)" : "transparent",
              color: key === dateKey ? "#060A10" : "var(--text-primary)",
            }}
          >
            {formatDateChip(key)}
          </button>
        ))}
      </div>

      {status.kind === "success" && (
        <div className="mb-4 p-4 rounded border" style={{ borderColor: "var(--success)", background: "rgba(61,255,176,0.08)" }}>
          <strong>Booked — {status.reference}</strong>
          <div className="text-sm opacity-80">Total: {tenant.currency} {((status.totalMinor ?? 0) / 100).toFixed(2)}</div>
        </div>
      )}
      {status.kind === "error" && (
        <div className="mb-4 p-4 rounded border" style={{ borderColor: "var(--tenant-accent)", background: "rgba(255,60,60,0.08)" }}>
          {status.message}
        </div>
      )}

      <div className="overflow-x-auto border rounded" style={{ borderColor: "var(--line-grid)" }} aria-busy={isPending}>
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              <th className="p-2 text-left sticky left-0" style={{ background: "var(--bg-panel)" }}>Time</th>
              {grid.courts.map((c) => (
                <th key={c.id} className="p-2 text-left whitespace-nowrap">{c.name}<div className="text-xs opacity-60 font-normal">{c.description}</div></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.courts[0]?.slots.map((_, i) => (
              <tr key={i}>
                <td className="p-2 font-mono text-xs sticky left-0" style={{ background: "var(--bg-panel)" }}>
                  {formatTime(grid.courts[0].slots[i].start)}
                </td>
                {grid.courts.map((court) => {
                  const slot = court.slots[i];
                  const isSelected = selected?.courtId === court.id && selected.start === slot.start;
                  const clickable = slot.status === "available";
                  return (
                    <td key={court.id} className="p-1">
                      <button
                        disabled={!clickable}
                        onClick={() => clickable && onSlotClick(court.id, court.name, slot.start, slot.end)}
                        className="w-full h-8 rounded text-xs"
                        style={{
                          background: isSelected ? "var(--tenant-primary)" : slot.status === "available" ? "rgba(61,255,176,0.12)" : slot.status === "booked" ? "rgba(255,60,60,0.12)" : "rgba(120,120,120,0.12)",
                          color: isSelected ? "#060A10" : "var(--text-dim)",
                          cursor: clickable ? "pointer" : "default",
                        }}
                      >
                        {isSelected ? "Selected" : slot.status === "available" ? "Open" : slot.status === "booked" ? "Booked" : "Maint."}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="mt-4 p-4 rounded border max-w-md" style={{ borderColor: "var(--line-grid)" }}>
          <h2 className="font-bold mb-2">{selected.courtName} — {formatTime(selected.start)}–{formatTime(selected.end)}</h2>
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="First name" className="border rounded p-2 bg-transparent" style={{ borderColor: "var(--line-grid)" }} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            <input placeholder="Last name" className="border rounded p-2 bg-transparent" style={{ borderColor: "var(--line-grid)" }} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            <input placeholder="Email" type="email" className="border rounded p-2 bg-transparent col-span-2" style={{ borderColor: "var(--line-grid)" }} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input placeholder="Phone" className="border rounded p-2 bg-transparent" style={{ borderColor: "var(--line-grid)" }} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input placeholder="Players" type="number" min={1} className="border rounded p-2 bg-transparent" style={{ borderColor: "var(--line-grid)" }} value={form.players} onChange={(e) => setForm({ ...form, players: Number(e.target.value) })} />
          </div>
          <button
            onClick={submitBooking}
            disabled={isPending}
            className="mt-3 w-full py-2 rounded font-bold"
            style={{ background: "var(--tenant-primary)", color: "#060A10" }}
          >
            {isPending ? "Booking..." : "Confirm Booking"}
          </button>
        </div>
      )}
    </main>
  );
}
