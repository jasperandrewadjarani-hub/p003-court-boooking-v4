"use client";

import { useEffect, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Line, Bar, Doughnut } from "react-chartjs-2";
import { fetchAnalyticsAction } from "@/app/admin/actions";
import type { AnalyticsData } from "@/lib/admin/analytics";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend);

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const CHART_COLORS = ["#C6FF3D", "#2EE6FF", "#FF2E7E", "#FFCA3A", "#3DFFB0", "#7C9A2E"];

export function AnalyticsManager({ initialData, currency }: { initialData: AnalyticsData; currency: string }) {
  const [from, setFrom] = useState(daysAgoKey(30));
  const [to, setTo] = useState(todayKey());
  const [data, setData] = useState(initialData);

  useEffect(() => {
    fetchAnalyticsAction(from, to).then(setData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function apply() {
    setData(await fetchAnalyticsAction(from, to));
  }

  return (
    <div className="admin-view">
      <div className="admin-topbar">
        <h2>Analytics</h2>
      </div>
      <div className="panel">
        <div className="admin-toolbar">
          <div className="field">
            <label>From</label>
            <input type="date" className="input-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" className="input-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button className="btn secondary" onClick={apply}>
            Apply
          </button>
          <a className="btn" style={{ marginLeft: "auto" }} href={`/admin/export?from=${from}&to=${to}`}>
            ⬇ Export to Excel
          </a>
        </div>
        <p className="dim mono" style={{ fontSize: 11 }}>
          Export includes: summary, detailed log, and payments — one workbook, three tabs.
        </p>
      </div>

      <div className="stat-cards">
        <StatCard label="Total Bookings" value={data.totalBookings} />
        <StatCard label="Cancelled" value={data.totalCancelled} />
        <StatCard label="Lapsed" value={data.totalLapsed} />
        <StatCard label="Total Revenue" value={`${currency} ${(data.totalRevenueMinor / 100).toFixed(2)}`} />
        <StatCard label="Avg Booking Value" value={`${currency} ${(data.avgValueMinor / 100).toFixed(2)}`} />
        <StatCard label="Cancellation Rate" value={`${data.cancellationRatePercent}%`} />
      </div>

      <div className="panel">
        <div className="panel__title">Revenue Over Time</div>
        <Line
          data={{
            labels: data.revenueOverTime.map((r) => r.date),
            datasets: [{ label: "Revenue", data: data.revenueOverTime.map((r) => r.revenueMinor / 100), borderColor: CHART_COLORS[0], backgroundColor: "rgba(198,255,61,0.15)" }],
          }}
          options={{ responsive: true }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px,1fr))", gap: 20 }}>
        <div className="panel">
          <div className="panel__title">Bookings by Status</div>
          <Doughnut
            data={{
              labels: data.bookingsByStatus.map((s) => s.status),
              datasets: [{ data: data.bookingsByStatus.map((s) => s.count), backgroundColor: CHART_COLORS }],
            }}
          />
        </div>
        <div className="panel">
          <div className="panel__title">Bookings by Court</div>
          <Bar
            data={{
              labels: data.bookingsByCourt.map((c) => c.courtName),
              datasets: [{ label: "Bookings", data: data.bookingsByCourt.map((c) => c.count), backgroundColor: CHART_COLORS[1] }],
            }}
          />
        </div>
        <div className="panel">
          <div className="panel__title">Bookings by Hour</div>
          <Bar
            data={{
              labels: data.bookingsByHour.map((h) => `${h.hour}:00`),
              datasets: [{ label: "Bookings", data: data.bookingsByHour.map((h) => h.count), backgroundColor: CHART_COLORS[2] }],
            }}
          />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
