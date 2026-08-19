"use client";

import { useState } from "react";
import {
  saveGeneralSettingsAction,
  saveBookingRulesAction,
  savePaymentSettingsAction,
  saveLoyaltySettingsAction,
  saveNotificationSettingsAction,
  savePerformanceSettingsAction,
  saveBrandingAction,
  resetBrandingAction,
  changeOwnPasswordAction,
} from "@/app/admin/actions";
import type { GeneralSettings, LoyaltySettings, NotificationSettings, PerformanceSettings, BrandingSettings } from "@/lib/admin/settings";
import type { BookingRulesSettings } from "@/lib/booking/availability";
import type { PaymentSettings } from "@/lib/booking/paymentSettings";

interface Props {
  general: GeneralSettings;
  rules: BookingRulesSettings;
  payments: PaymentSettings;
  loyalty: LoyaltySettings;
  notifications: NotificationSettings;
  performance: PerformanceSettings;
  branding: BrandingSettings;
}

// Branding swatch groups (v3b Settings "Branding & Logo" layout).
const DARK_SWATCHES: [keyof BrandingSettings, string][] = [
  ["primary", "Primary Accent"], ["secondary", "Secondary Accent"], ["danger", "Danger Accent"],
  ["darkBackground", "App Background"], ["darkPanel", "Panel & Sidebar"], ["darkSurface", "Raised Surface"],
  ["darkOption", "Inputs & Options"], ["darkGrid", "Grid Lines & Borders"], ["darkFont", "Main Font"],
  ["darkMutedFont", "Muted Font"], ["darkOpenSlotFont", "Open Slot Font"], ["darkSelectedSlotFont", "Selected Slot Font"],
];
const LIGHT_SWATCHES: [keyof BrandingSettings, string][] = [
  ["lightPrimary", "Primary Accent"], ["lightSecondary", "Secondary Accent"], ["lightDanger", "Danger Accent"],
  ["lightBackground", "App Background"], ["lightPanel", "Panel & Sidebar"], ["lightSurface", "Raised Surface"],
  ["lightOption", "Inputs & Options"], ["lightGrid", "Grid Lines & Borders"], ["lightFont", "Main Font"],
  ["lightMutedFont", "Muted Font"], ["lightOpenSlotFont", "Open Slot Font"], ["lightSelectedSlotFont", "Selected Slot Font"],
];
const STATE_SWATCHES: [keyof BrandingSettings, string][] = [
  ["confirmed", "Confirmed / Active"], ["reserved", "Reserved"], ["inactive", "Cancelled / Lapsed / Blocked"],
  ["unpaid", "Unpaid Medal"], ["awaiting", "Awaiting Verification Medal"], ["paid", "Paid Medal"],
];

export function SettingsManager({ general, rules, payments, loyalty, notifications, performance, branding }: Props) {
  const [generalForm, setGeneralForm] = useState(general);
  const [rulesForm, setRulesForm] = useState(rules);
  const [paymentsForm, setPaymentsForm] = useState(payments);
  const [loyaltyForm, setLoyaltyForm] = useState(loyalty);
  const [notifForm, setNotifForm] = useState(notifications);
  const [perfForm, setPerfForm] = useState(performance);
  const [brandForm, setBrandForm] = useState(branding);
  const [status, setStatus] = useState<string | null>(null);

  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);

  async function saveAll() {
    setStatus("Saving…");
    const results = await Promise.all([
      saveGeneralSettingsAction(generalForm),
      saveBookingRulesAction(rulesForm),
      savePaymentSettingsAction(paymentsForm),
      saveLoyaltySettingsAction(loyaltyForm),
      saveNotificationSettingsAction(notifForm),
      savePerformanceSettingsAction(perfForm),
      saveBrandingAction(brandForm),
    ]);
    const failed = results.find((r) => !r.ok);
    setStatus(failed ? `Error: ${(failed as any).error}` : "Saved. Reload to see theme changes.");
  }

  async function restoreBranding() {
    setStatus("Restoring…");
    const res = await resetBrandingAction();
    setStatus(res.ok ? "Branding restored. Reload to see it." : `Error: ${(res as any).error}`);
  }

  // Reads a chosen image file into a validated data: URI (image/* only, ≤1.4MB
  // source ≈ 2MB encoded — matches the server-side cap). Lets an admin UPLOAD a
  // logo/QR from disk, same capability v3b had via Google Drive; here the bytes
  // land inline in the setting instead of a Drive file (invisible to end users).
  const MAX_UPLOAD_BYTES = 1_400_000;
  function pickImage(onData: (dataUri: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow re-picking the same file
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setStatus("Error: logo/QR must be an image file (PNG, JPG, WebP, or GIF).");
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setStatus(`Error: image is too large (${(file.size / 1024 / 1024).toFixed(1)}MB) — please use one under 1.4MB.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => onData(String(reader.result));
      reader.readAsDataURL(file);
    };
  }

  function Swatch({ k, label }: { k: keyof BrandingSettings; label: string }) {
    const val = String(brandForm[k]);
    return (
      <div className="settings-field">
        <label>{label}</label>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="color" style={{ width: 40, padding: 2 }} value={val} onChange={(e) => setBrandForm({ ...brandForm, [k]: e.target.value.toUpperCase() })} />
          <input value={val} onChange={(e) => setBrandForm({ ...brandForm, [k]: e.target.value.toUpperCase() })} />
        </div>
      </div>
    );
  }

  async function changePassword() {
    setPwError(null);
    if (pwNew !== pwConfirm) {
      setPwError("Passwords don't match.");
      return;
    }
    const res = await changeOwnPasswordAction(pwCurrent, pwNew);
    if (res.ok) {
      setPwCurrent("");
      setPwNew("");
      setPwConfirm("");
      setPwError("Password changed.");
    } else {
      setPwError(res.error);
    }
  }

  return (
    <div className="admin-view">
      <div className="admin-topbar">
        <h2>Business Settings</h2>
      </div>
      <div className="panel">
        <div className="settings-section-title">General</div>
        <div className="settings-grid">
          <div className="settings-field">
            <label>Business Name</label>
            <input value={generalForm.name} onChange={(e) => setGeneralForm({ ...generalForm, name: e.target.value })} />
          </div>
          <div className="settings-field">
            <label>Timezone</label>
            <input value={generalForm.timezone} onChange={(e) => setGeneralForm({ ...generalForm, timezone: e.target.value })} />
          </div>
          <div className="settings-field">
            <label>Currency</label>
            <input value={generalForm.currency} onChange={(e) => setGeneralForm({ ...generalForm, currency: e.target.value })} />
          </div>
          <div className="settings-field">
            <label>Web App Title</label>
            <input value={generalForm.webAppTitle} onChange={(e) => setGeneralForm({ ...generalForm, webAppTitle: e.target.value })} />
          </div>
        </div>

        <details className="dashboard-collapsible" style={{ marginTop: 12 }}>
          <summary>
            <span className="collapsed-label">Show Branding &amp; Logo</span>
            <span className="expanded-label">Hide Branding &amp; Logo</span>
          </summary>
          <div className="settings-section-title">Dark Theme</div>
          <div className="settings-grid">
            {DARK_SWATCHES.map(([k, label]) => (
              <Swatch key={k} k={k} label={label} />
            ))}
          </div>
          <div className="settings-section-title">Light Theme</div>
          <div className="settings-grid">
            {LIGHT_SWATCHES.map(([k, label]) => (
              <Swatch key={k} k={k} label={label} />
            ))}
          </div>
          <div className="settings-section-title">Shared Booking &amp; Payment States</div>
          <div className="settings-grid">
            {STATE_SWATCHES.map(([k, label]) => (
              <Swatch key={k} k={k} label={label} />
            ))}
          </div>
          <div className="settings-grid" style={{ marginTop: 12 }}>
            <div className="settings-field">
              <label>Court Label Header Color (customer + admin grids)</label>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="color"
                  style={{ width: 40, padding: 2 }}
                  value={/^#[0-9A-Fa-f]{6}$/.test(brandForm.courtHeaderColor) ? brandForm.courtHeaderColor : "#C6FF3D"}
                  onChange={(e) => setBrandForm({ ...brandForm, courtHeaderColor: e.target.value.toUpperCase() })}
                />
                <input value={brandForm.courtHeaderColor} onChange={(e) => setBrandForm({ ...brandForm, courtHeaderColor: e.target.value.toUpperCase() })} placeholder="Default (green / cyan)" />
              </div>
              {brandForm.courtHeaderColor && (
                <button type="button" className="dim mono" style={{ marginTop: 6, background: "none", border: "none", textDecoration: "underline", cursor: "pointer", fontSize: 11, padding: 0, textAlign: "left" }} onClick={() => setBrandForm({ ...brandForm, courtHeaderColor: "" })}>
                  Use default colors
                </button>
              )}
            </div>
          </div>
          <div className="settings-grid" style={{ marginTop: 12 }}>
            <div className="settings-field">
              <label>Business Logo</label>
              <input type="file" accept="image/*" onChange={pickImage((d) => setBrandForm({ ...brandForm, logoUrl: d }))} />
              <input style={{ marginTop: 6 }} value={brandForm.logoUrl.startsWith("data:") ? "" : brandForm.logoUrl} onChange={(e) => setBrandForm({ ...brandForm, logoUrl: e.target.value })} placeholder="…or paste an image URL" />
            </div>
            <div className="settings-field">
              <label>Logo Preview</label>
              {brandForm.logoUrl ? (
                <>
                  <div className="settings-image-preview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={brandForm.logoUrl} alt="logo" />
                  </div>
                  <button type="button" className="dim mono" style={{ marginTop: 6, background: "none", border: "none", textDecoration: "underline", cursor: "pointer", fontSize: 11, padding: 0, textAlign: "left" }} onClick={() => setBrandForm({ ...brandForm, logoUrl: "" })}>
                    Remove logo
                  </button>
                </>
              ) : (
                <span className="dim mono" style={{ fontSize: 11 }}>No logo set</span>
              )}
            </div>
          </div>
          <button className="btn secondary" style={{ marginTop: 12 }} onClick={restoreBranding}>
            Restore Default VOLT Colors
          </button>
        </details>

        <div className="settings-section-title">Booking Rules</div>
        <div className="settings-grid">
          {(
            [
              ["customerGridStartTime", "Customer Grid Start"],
              ["customerGridEndTime", "Customer Grid End"],
              ["adminGridStartTime", "Admin Grid Start"],
              ["adminGridEndTime", "Admin Grid End"],
            ] as [keyof BookingRulesSettings, string][]
          ).map(([key, label]) => (
            <div className="settings-field" key={key}>
              <label>{label} (HH:MM)</label>
              <input
                type="text"
                placeholder="HH:MM"
                value={String(rulesForm[key])}
                onChange={(e) => setRulesForm({ ...rulesForm, [key]: e.target.value })}
              />
            </div>
          ))}
          {(
            [
              ["slotMinutes", "Slot Minutes"],
              ["turnoverBufferMinutes", "Buffer Minutes"],
              ["maxAdvanceBookingDays", "Max Advance Booking Days"],
              ["minBookingMinutes", "Min Booking Minutes"],
              ["maxBookingMinutes", "Max Booking Minutes"],
              ["maxCourtHoursPerBooking", "Max Court Hours Per Booking"],
              ["maxPendingCustomerBookings", "Max Pending Customer Bookings"],
              ["cancellationWindowHours", "Cancellation Window Hours"],
              ["taxRatePercent", "Tax Rate Percent"],
              ["reservationHoldMinutes", "Reservation Hold Minutes"],
              ["receiptReviewHoldMinutes", "Receipt Review Hold Minutes"],
            ] as [keyof BookingRulesSettings, string][]
          ).map(([key, label]) => (
            <div className="settings-field" key={key}>
              <label>{label}</label>
              <input type="number" value={Number(rulesForm[key])} onChange={(e) => setRulesForm({ ...rulesForm, [key]: Number(e.target.value) })} />
            </div>
          ))}
        </div>

        <div className="settings-section-title">Loyalty</div>
        <div className="settings-grid">
          <div className="settings-field">
            <label>Loyalty Currency Per Point</label>
            <input type="number" value={loyaltyForm.loyaltyCurrencyPerPoint} onChange={(e) => setLoyaltyForm({ ...loyaltyForm, loyaltyCurrencyPerPoint: Number(e.target.value) })} />
          </div>
          <div className="settings-field">
            <label>Loyalty Points For Free Hour</label>
            <input type="number" value={loyaltyForm.loyaltyPointsForFreeHour} onChange={(e) => setLoyaltyForm({ ...loyaltyForm, loyaltyPointsForFreeHour: Number(e.target.value) })} />
          </div>
        </div>

        <div className="settings-section-title">Payments &amp; QR</div>
        <div className="settings-grid">
          <div className="settings-field">
            <label>GCash Number</label>
            <input value={paymentsForm.gcashNumber ?? ""} onChange={(e) => setPaymentsForm({ ...paymentsForm, gcashNumber: e.target.value })} />
          </div>
          <div className="settings-field">
            <label>GCash Account Name</label>
            <input value={paymentsForm.gcashAccountName ?? ""} onChange={(e) => setPaymentsForm({ ...paymentsForm, gcashAccountName: e.target.value })} />
          </div>
          <div className="settings-field">
            <label>Payment Instructions</label>
            <input value={paymentsForm.paymentInstructions ?? ""} onChange={(e) => setPaymentsForm({ ...paymentsForm, paymentInstructions: e.target.value })} />
          </div>
        </div>

        <div className="settings-field" style={{ marginTop: 4 }}>
          <label>Payment QR Images (up to 4 — customers select/swipe between them at checkout)</label>
        </div>
        <div className="settings-grid">
          {Array.from({ length: 4 }, (_, i) => {
            const img = paymentsForm.qrImages[i];
            function setSlot(value: string | null) {
              const next = [...paymentsForm.qrImages];
              if (value) next[i] = value;
              else next.splice(i, 1); // remove — shifts later slots down rather than leaving a gap
              setPaymentsForm({ ...paymentsForm, qrImages: next });
            }
            return (
              <div className="settings-field" key={i}>
                <label>QR #{i + 1}</label>
                {img ? (
                  <>
                    <div className="settings-image-preview">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img} alt={`Payment QR ${i + 1}`} style={{ background: "#fff" }} />
                    </div>
                    <button type="button" className="dim mono" style={{ marginTop: 6, background: "none", border: "none", textDecoration: "underline", cursor: "pointer", fontSize: 11, padding: 0, textAlign: "left" }} onClick={() => setSlot(null)}>
                      Remove
                    </button>
                  </>
                ) : (
                  <input type="file" accept="image/*" onChange={pickImage((d) => setSlot(d))} disabled={i > paymentsForm.qrImages.length} />
                )}
              </div>
            );
          })}
        </div>

        <div className="settings-section-title">Reports &amp; Notifications</div>
        <div className="settings-grid">
          {(
            [
              ["customerBookingEmail", "Customer Booking Email"],
              ["adminNewBookingAlert", "Admin New Booking Alert"],
              ["customerPaymentEmail", "Customer Payment Email"],
              ["adminReceiptAlert", "Admin Receipt Alert"],
              ["customerReminders", "Customer Reminders"],
              ["dailyReport", "Daily Report"],
              ["weeklyReportEnabled", "Weekly Report"],
            ] as [keyof NotificationSettings, string][]
          ).map(([key, label]) => (
            <div className="settings-field" key={key}>
              <label>{label}</label>
              <select value={notifForm[key] ? "TRUE" : "FALSE"} onChange={(e) => setNotifForm({ ...notifForm, [key]: e.target.value === "TRUE" })}>
                <option>TRUE</option>
                <option>FALSE</option>
              </select>
            </div>
          ))}
          <div className="settings-field">
            <label>Weekly Report Day</label>
            <input value={notifForm.weeklyReportDay} onChange={(e) => setNotifForm({ ...notifForm, weeklyReportDay: e.target.value })} placeholder="SUNDAY" />
          </div>
          <div className="settings-field">
            <label>Admin Emails</label>
            <input value={notifForm.adminEmails} onChange={(e) => setNotifForm({ ...notifForm, adminEmails: e.target.value })} placeholder="comma-separated" />
          </div>
          <div className="settings-field">
            <label>Notification BCC</label>
            <input value={notifForm.notificationBcc} onChange={(e) => setNotifForm({ ...notifForm, notificationBcc: e.target.value })} />
          </div>
        </div>

        <div className="settings-section-title">Performance &amp; Storage</div>
        <div className="settings-grid">
          <div className="settings-field">
            <label>Audit Log Writes</label>
            <select value={perfForm.auditLogEnabled ? "TRUE" : "FALSE"} onChange={(e) => setPerfForm({ ...perfForm, auditLogEnabled: e.target.value === "TRUE" })}>
              <option>TRUE</option>
              <option>FALSE</option>
            </select>
          </div>
        </div>

        <button className="btn" style={{ marginTop: 24 }} onClick={saveAll}>
          Save Settings
        </button>
        {status && (
          <p className="dim mono" style={{ fontSize: 11, marginTop: 10 }}>
            {status}
          </p>
        )}
      </div>

      <div className="panel">
        <div className="settings-section-title">My Admin Password</div>
        <div className="inline-form">
          <div>
            <label>Current Password</label>
            <input type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} autoComplete="current-password" />
          </div>
          <div>
            <label>New Password</label>
            <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} autoComplete="new-password" />
          </div>
          <div>
            <label>Confirm New Password</label>
            <input type="password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} autoComplete="new-password" />
          </div>
        </div>
        {pwError && <div className="field-warning">{pwError}</div>}
        <button className="btn secondary" style={{ marginTop: 14 }} onClick={changePassword}>
          Change Password
        </button>
        <p className="dim mono" style={{ fontSize: 11, marginTop: 10 }}>
          Passwords are stored as Argon2id hashes, not plaintext.
        </p>
      </div>
    </div>
  );
}
