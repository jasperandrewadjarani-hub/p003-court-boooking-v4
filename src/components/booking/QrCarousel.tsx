"use client";

import { useEffect, useState } from "react";
import { fetchPaymentQrImagesAction } from "@/app/actions";

/** Payment-QR carousel with swipe, dots, and download. QR images are fetched on
 * demand (not shipped in any page payload). Reused by the success modal and the
 * "make payment now" panel in My Bookings. */
export function QrCarousel() {
  const [qrImages, setQrImages] = useState<string[]>([]);
  const [qrIndex, setQrIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetchPaymentQrImagesAction().then((imgs) => { if (live) setQrImages(imgs); });
    return () => { live = false; };
  }, []);

  if (qrImages.length === 0) return null;

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

  return (
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
  );
}
