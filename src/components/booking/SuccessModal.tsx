"use client";

import { useState } from "react";
import { QrCarousel } from "@/components/booking/QrCarousel";
import { ReceiptUpload } from "@/components/booking/ReceiptUpload";
import type { PaymentSettings } from "@/lib/booking/paymentSettings";

interface Props {
  bookingGroupId: string;
  reference: string;
  totalMinor: number;
  currency: string;
  reservationHoldMinutes: number;
  paymentSettings: PaymentSettings;
  onDone: (receiptUploaded: boolean) => void;
}

/** Matches v2's #successModal — Booking ID, amount due, hold-window notice,
 * GCash number/QR from tenant settings, optional immediate receipt upload
 * (image/PDF, 5MB cap) that can be changed or removed if a mistake was made. */
export function SuccessModal({ bookingGroupId, reference, totalMinor, currency, reservationHoldMinutes, paymentSettings, onDone }: Props) {
  const [uploaded, setUploaded] = useState(false);

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ borderColor: "var(--accent-optic)", boxShadow: "0 0 40px rgba(198,255,61,0.2)" }}>
        <h3 style={{ color: "var(--accent-optic)" }}>Booking Successful</h3>
        <p className="mono">
          Booking ID: <strong>{reference}</strong>
        </p>

        <div className="payment-box">
          <div className="mono dim" style={{ fontSize: 11, textTransform: "uppercase" }}>
            Please settle
          </div>
          <div className="amount">
            {currency} {(totalMinor / 100).toFixed(2)}
          </div>
          <p className="mono dim" style={{ fontSize: 12 }}>
            Reserve held for {reservationHoldMinutes} minutes — pay and upload your receipt before then to keep this slot.
          </p>
          {paymentSettings.gcashNumber ? (
            <p className="mono" style={{ fontSize: 13 }}>
              GCash: {paymentSettings.gcashNumber} ({paymentSettings.gcashAccountName})
            </p>
          ) : (
            <p className="mono dim" style={{ fontSize: 13 }}>
              Payment details haven&apos;t been configured yet — ask staff how to pay.
            </p>
          )}
          <QrCarousel />
          {paymentSettings.paymentInstructions && (
            <p className="mono dim" style={{ fontSize: 12 }}>
              {paymentSettings.paymentInstructions}
            </p>
          )}
        </div>

        <ReceiptUpload bookingGroupId={bookingGroupId} initialHasReceipt={false} onChanged={setUploaded} />
        <p className="dim mono" style={{ fontSize: 11, marginTop: 10 }}>
          Or upload later anytime from &quot;My Bookings.&quot;
        </p>

        <button className="btn block" style={{ marginTop: 18 }} onClick={() => onDone(uploaded)}>
          Done
        </button>
      </div>
    </div>
  );
}
