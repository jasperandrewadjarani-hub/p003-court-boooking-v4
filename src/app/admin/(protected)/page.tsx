import { resolveTenant } from "@/lib/tenant/resolve";
import { getDashboardStats, getRecentBookings } from "@/lib/admin/dashboard";
import { getDispatchGrid } from "@/lib/admin/dispatchGrid";
import { getActiveMemberships } from "@/lib/booking/memberships";
import { DispatchGrid } from "@/components/admin/DispatchGrid";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
}

export default async function AdminDashboardPage() {
  const tenant = await resolveTenant();
  const dateKey = todayKey();
  const [stats, recentBookings, grid, memberships] = await Promise.all([
    getDashboardStats(tenant.id),
    getRecentBookings(tenant.id),
    getDispatchGrid(tenant.id, dateKey),
    getActiveMemberships(tenant.id),
  ]);

  return (
    <div className="admin-view" id="view-dashboard">
      <div className="admin-topbar">
        <h2>Dashboard</h2>
      </div>

      <details className="dashboard-collapsible dashboard-stats">
        <summary>
          <span className="collapsed-label">Show Stats</span>
          <span className="expanded-label">Hide Stats</span>
        </summary>
        <div className="stat-cards">
          <StatCard label="Today's Bookings" value={stats.todayBookings} />
          <StatCard label="Cancelled Today" value={stats.todayCancelled} />
          <StatCard label="Lapsed Today" value={stats.todayLapsed} />
          <StatCard label="Revenue Today" value={`${tenant.currency} ${(stats.revenueToday / 100).toFixed(2)}`} />
          <StatCard label="Booked Value Today" value={`${tenant.currency} ${(stats.bookedValueToday / 100).toFixed(2)}`} />
          <StatCard label="Active Now" value={stats.activeNow} />
          <StatCard label="Total Customers" value={stats.totalCustomers} />
        </div>
      </details>

      <DispatchGrid initialGrid={grid} currency={tenant.currency} memberships={memberships} />

      <details className="panel dashboard-collapsible recent-bookings-panel">
        <summary>
          <span className="collapsed-label">Show Recent Bookings</span>
          <span className="expanded-label">Hide Recent Bookings</span>
        </summary>
        <div className="table-scroll-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Items</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {recentBookings.map((b) => (
                <tr key={b.id}>
                  <td>{b.reference ?? "Pending"}</td>
                  <td className="recent-items-cell">
                    {b.items.map((item, i) => (
                      <div key={i}>
                        {item.courtName} {formatTime(item.start)}–{formatTime(item.end)}
                      </div>
                    ))}
                  </td>
                  <td>{b.customerName}</td>
                  <td>{b.status}</td>
                  <td>{b.paymentStatus}</td>
                  <td>
                    {tenant.currency} {(b.totalMinor / 100).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
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
