"use client";

import { useState } from "react";
import {
  saveGeneralSettingsAction,
  saveBookingRulesAction,
  savePaymentSettingsAction,
  saveLoyaltySettingsAction,
  saveNotificationSettingsAction,
  changeOwnPasswordAction,
} from "@/app/admin/actions";
import type { GeneralSettings, LoyaltySettings, NotificationSettings } from "@/lib/admin/settings";
import type { BookingRulesSettings } from "@/lib/booking/availability";
import type { PaymentSettings } from "@/lib/booking/paymentSettings";

interface Props {
  general: GeneralSettings;
  rules: BookingRulesSettings;
  payments: PaymentSettings;
  loyalty: LoyaltySettings;
  notifications: NotificationSettings;
}

export function SettingsManager({ general, rules, payments, loyalty, notifications }: Props) {
  const [generalForm, setGeneralForm] = useState(general);
  const [rulesForm, setRulesForm] = useState(rules);
  const [paymentsForm, setPaymentsForm] = useState(payments);
  const [loyaltyForm, setLoyaltyForm] = useState(loyalty);
  const [notifForm, setNotifForm] = useState(notifications);
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
    ]);
    const failed = results.find((r) => !r.ok);
    setStatus(failed ? `Error: ${(failed as any).error}` : "Saved.");
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
        </div>

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
        <p className="dim mono" style={{ fontSize: 11 }}>
          QR image upload requires Supabase Storage — not configured yet (see notes.md), coming with the real Storage transport in Phase F.
        </p>

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
            <label>Admin Emails</label>
            <input value={notifForm.adminEmails} onChange={(e) => setNotifForm({ ...notifForm, adminEmails: e.target.value })} placeholder="comma-separated" />
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
