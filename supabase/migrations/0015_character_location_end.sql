-- ===========================================================================
-- 0015 — start/end location per character per chapter
--
-- A character_locations row gains an OPTIONAL end place, so a chapter can
-- contain movement: `place_id` is where the character STARTS the chapter
-- (existing rows keep their meaning unchanged — their single place becomes
-- the start), `end_place_id` is where they END it. NULL end = no movement.
-- Additive only (ALTER TABLE ... ADD COLUMN IF NOT EXISTS); no data rewrite.
-- ===========================================================================

alter table public.character_locations
  add column if not exists end_place_id uuid references public.places (id) on delete set null;

comment on column public.character_locations.place_id is
  'Where the character STARTS this chapter (legacy single location = start).';
comment on column public.character_locations.end_place_id is
  'Optional: where the character ENDS this chapter. NULL = did not move.';
