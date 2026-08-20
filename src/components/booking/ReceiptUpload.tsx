"use client";

import { useState } from "react";
import { uploadReceiptAction, removeReceiptAction } from "@/lib/booking/receipts";

const MAX_BYTES = 5 * 1024 * 1024;

/** Receipt upload with change/remove — used by the success modal and the "make
 * payment now" panel in My Bookings. Reports the current has-receipt state back
 * to the parent via onChanged. */
export function ReceiptUpload({
  bookingGroupId,
  initialHasReceipt,
  onChanged,
}: {
  bookingGroupId: string;
  initialHasReceipt: boolean;
  onChanged?: (hasReceipt: boolean) => void;
}) {
  const [hasReceipt, setHasReceipt] = useState(initialHasReceipt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) {
      setError("File is too large — max 5MB.");
      return;
    }
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      const res = await uploadReceiptAction(bookingGroupId, bytes, file.type);
      if (res.ok) {
        setHasReceipt(true);
        onChanged?.(true);
      } else {
        setError(res.error);
      }
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove the uploaded receipt?")) return;
    setBusy(true);
    setError(null);
    const res = await removeReceiptAction(bookingGroupId);
    setBusy(false);
    if (res.ok) {
      setHasReceipt(false);
      onChanged?.(false);
    } else {
      setError(res.error);
    }
  }

  return (
    <div>
      {!hasReceipt ? (
        <>
          <label>Upload Payment Receipt (image or PDF)</label>
          <input type="file" accept="image/*,application/pdf" onChange={onFileSelected} disabled={busy} />
        </>
      ) : (
        <div>
          <span className="receipt-state uploaded">✓ Receipt uploaded</span>
          <div className="receipt-actions">
            <label className="receipt-link">
              Change receipt
              <input type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={onFileSelected} disabled={busy} />
            </label>
            <button type="button" className="receipt-link" onClick={remove} disabled={busy}>
              Remove
            </button>
          </div>
        </div>
      )}
      {busy && <p className="dim mono" style={{ fontSize: 12, marginTop: 8 }}>Working…</p>}
      {error && <div className="field-warning">{error}</div>}
    </div>
  );
}
