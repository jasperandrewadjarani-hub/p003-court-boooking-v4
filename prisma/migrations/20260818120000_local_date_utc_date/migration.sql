-- Fix a day-shift bug in bookings.local_date.
--
-- The whole app uses a "floating-UTC" time convention: slot times are stored
-- as wall-clock-in-UTC (create.ts toUtcDate -> `${dateKey}T${time}:00.000Z`)
-- and rendered with getUTCHours() (formatUtcTime, in dispatchGrid/bookings/
-- dashboard/customerBookings). Under that convention a 7:00 PM slot is stored
-- as 19:00Z and displayed as "19:00".
--
-- But bookings_set_derived() computed local_date via a REAL timezone
-- conversion: (starts_at AT TIME ZONE tz)::date. For Asia/Manila (UTC+8) that
-- turns 19:00Z into 03:00 the NEXT calendar day, so every evening booking
-- (>= 16:00Z, i.e. the 4pm-midnight display slots) landed on the following
-- day — a Monday 7pm booking showed up on Tuesday. This was latent for the
-- app's own bookings (only daytime slots were tested) and surfaced clearly
-- when the Zamboanga workbook's many evening bookings were imported.
--
-- Fix: derive local_date from the UTC calendar date, matching how times are
-- stored and displayed everywhere else. block_range is unchanged (it uses the
-- real instants for overlap detection and was never affected).
CREATE OR REPLACE FUNCTION bookings_set_derived() RETURNS trigger AS $$
BEGIN
  NEW.block_range := tstzrange(
      NEW.starts_at,
      NEW.ends_at + make_interval(mins => NEW.turnover_buffer_minutes),
      '[)');
  NEW.local_date := (NEW.starts_at AT TIME ZONE 'UTC')::date;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Recompute local_date for every existing row by re-firing the BEFORE UPDATE
-- trigger (same pattern as 20260812095000_fix_timestamptz).
UPDATE "bookings" SET "id" = "id";
