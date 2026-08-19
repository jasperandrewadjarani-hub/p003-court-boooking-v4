"use client";

import { useEffect, useState } from "react";
import { uploadReceiptAction } from "@/lib/booking/receipts";
import { fetchPaymentQrImagesAction } from "@/app/actions";
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

const MAX_BYTES = 5 * 1024 * 1024;

/** Matches v2's #successModal — Booking ID, amount due, hold-window notice,
 * GCash number/QR from tenant settings, optional immediate receipt upload
 * (image/PDF, 5MB cap). */
export function SuccessModal({ bookingGroupId, reference, totalMinor, currency, reservationHoldMinutes, paymentSettings, onDone }: Props) {
  const [status, setStatus] = useState<"idle" | "uploading" | "uploaded" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);
  // QR images are fetched on demand (not shipped in the page payload) — see
  // fetchPaymentQrImagesAction. This modal only appears after a booking, which
  // is the one moment the QRs are actually needed.
  const [qrImages, setQrImages] = useState<string[]>([]);
  const [qrIndex, setQrIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetchPaymentQrImagesAction().then((imgs) => { if (live) setQrImages(imgs); });
    return () => { live = false; };
  }, []);

  function goQr(delta: number) {
    setQrIndex((i) => (i + delta + qrImages.length) % qrImages.length);
  }
  function downloadQr() {
    const uri = qrImages[qrIndex];
    if (!uri) return;
    const ext = uri.startsWith("data:image/png") ? "png" : uri.startsWith("data:image/webp") ? "webp" : "jpg";
    const a = document.createElement("a");
    a.href = uri;
    a.download = `payment-qr-${qrIndex + 1}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) {
      setStatus("error");
      setError("File is too large — max 5MB.");
      return;
    }
    setStatus("uploading");
    try {
      const bytes = await file.arrayBuffer();
      const res = await uploadReceiptAction(bookingGroupId, bytes, file.type);
      if (res.ok) {
        setStatus("uploaded");
        setUploaded(true);
      } else {
        setStatus("error");
        setError(res.error);
      }
    } catch {
      setStatus("error");
      setError("Upload failed. Please try again.");
    }
  }

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
          {qrImages.length > 0 && (
            <div className="qr-carousel">
              <div
                className="qr-carousel-frame"
                onTouchStart={(e) => setTouchStartX(e.touches[0].clientX)}
                onTouchEnd={(e) => {
                  if (touchStartX === null) return;
                  const delta = e.changedTouches[0].clientX - touchStartX;
                  if (Math.abs(delta) > 40) goQr(delta < 0 ? 1 : -1);
                  setTouchStartX(null);
                }}
              >
                {qrImages.length > 1 && (
                  <button type="button" className="qr-carousel-arrow left" onClick={() => goQr(-1)} aria-label="Previous QR">
                    ‹
                  </button>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="qr" src={qrImages[qrIndex]} alt={`Payment QR ${qrIndex + 1} of ${qrImages.length}`} />
                {qrImages.length > 1 && (
                  <button type="button" className="qr-carousel-arrow right" onClick={() => goQr(1)} aria-label="Next QR">
                    ›
                  </button>
                )}
              </div>
              {qrImages.length > 1 && (
                <div className="qr-carousel-dots">
                  {qrImages.map((_, i) => (
                    <button key={i} type="button" className={`qr-carousel-dot ${i === qrIndex ? "active" : ""}`} onClick={() => setQrIndex(i)} aria-label={`Show QR ${i + 1}`} />
                  ))}
                </div>
              )}
              <button type="button" className="btn secondary" style={{ marginTop: 8 }} onClick={downloadQr}>
                ⬇ Download QR
              </button>
            </div>
          )}
          {paymentSettings.paymentInstructions && (
            <p className="mono dim" style={{ fontSize: 12 }}>
              {paymentSettings.paymentInstructions}
            </p>
          )}
        </div>

        <label>Upload Payment Receipt Now (optional)</label>
        <input type="file" accept="image/*,application/pdf" onChange={onFileSelected} disabled={status === "uploading" || uploaded} />
        {status === "uploading" && <p className="dim mono" style={{ fontSize: 12, marginTop: 8 }}>Uploading…</p>}
        {status === "uploaded" && (
          <span className="receipt-state uploaded" style={{ marginTop: 8 }}>
            ✓ Receipt uploaded
          </span>
        )}
        {status === "error" && <div className="field-warning">{error}</div>}
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
