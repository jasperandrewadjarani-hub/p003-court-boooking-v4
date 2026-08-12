"use client";

interface Props {
  reservationHoldMinutes: number;
  onReturnToUpload: () => void;
  onProceedAnyway: () => void;
}

/** Matches v2's #receiptReminderModal — nags once if the customer clicks
 * "Done" without uploading a receipt, since the reservation will otherwise
 * auto-lapse after the unpaid hold window (sweepLapsedBookings, Phase B). */
export function ReceiptReminderModal({ reservationHoldMinutes, onReturnToUpload, onProceedAnyway }: Props) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Payment Receipt Not Uploaded</h3>
        <p className="mono" style={{ fontSize: 13, lineHeight: 1.7 }}>
          Without a receipt on file, this reservation will automatically lapse after {reservationHoldMinutes} minutes if unpaid. You can still upload it later from &quot;My Bookings&quot; if you&apos;ve already paid.
        </p>
        <button className="btn secondary block" onClick={onReturnToUpload}>
          Return to Receipt Upload
        </button>
        <button className="btn block" style={{ marginTop: 10 }} onClick={onProceedAnyway}>
          Proceed Anyway, I Will Pay Later
        </button>
      </div>
    </div>
  );
}
