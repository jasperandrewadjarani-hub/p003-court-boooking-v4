-- Real, client-reported bug: booking 3+ consecutive back-to-back hours on
-- the SAME court in ONE cart always failed with "slot taken", even though
-- every slot was genuinely vacant. Root cause: block_range extends each
-- item's end by turnover_buffer_minutes (10 min default) so staff have
-- reset time between DIFFERENT customers' bookings. For two ADJACENT items
-- within the same cart (e.g. 6-7am and 7-8am on Court 1), item 1's buffered
-- range [6:00, 7:10) overlaps item 2's range [7:00, 8:00) — the exclusion
-- constraint doesn't know these two rows are the same checkout, so it
-- (correctly, by its old definition) rejected them as conflicting.
--
-- Fix: add booking_group_id WITH <> to the exclusion constraint. This is
-- PostgreSQL's own documented pattern for "exclude overlaps only between
-- different groups" (see the range types docs' room-booking example) —
-- btree_gist already provides the <> operator class needed. Two rows now
-- only conflict if they belong to DIFFERENT booking groups; multiple items
-- in the same cart/checkout can be adjacent or (via the exact same
-- mechanism) briefly overlap without spuriously blocking each other, while
-- two DIFFERENT customers still cannot double-book the same buffered
-- window — the actual guarantee this constraint exists for.

ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_no_overlap";

DO $$ BEGIN
  ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_no_overlap"
    EXCLUDE USING gist (
      "tenant_id" WITH =,
      "court_id"  WITH =,
      "booking_group_id" WITH <>,
      "block_range" WITH &&
    ) WHERE ("status" IN ('reserved', 'confirmed', 'checked_in', 'playing'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
