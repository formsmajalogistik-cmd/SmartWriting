-- ===========================================================================
-- 0018 — "anwesend" vs. "erwähnt": how a character relates to a chapter
--
-- A character linked to a chapter is either PRESENT (anwesend — on stage, with
-- an optional start/end place) or only MENTIONED (erwähnt — talked about, no
-- location, so no map token, no route segment, no carry-forward). This is a
-- separate axis from the life status (lebt / stirbt / tot / unbekannt), which
-- stays untouched.
--
-- Stored as ASCII machine values ('anwesend' | 'erwaehnt'); the UI shows
-- "anwesend" / "erwähnt". ASCII avoids Unicode normalisation pitfalls (an "ä"
-- can arrive composed or decomposed) in a value that is compared in code.
--
-- Rows that describe a PLACE present in the chapter (character_id NULL) also
-- carry the column; for them it is always 'anwesend' and has no meaning.
--
-- Migration of existing data: every existing link becomes 'anwesend' — the
-- column default fills all existing rows when it is added, and the UPDATE
-- below makes that explicit (idempotent, safe to re-run).
-- ===========================================================================

alter table public.character_locations
  add column if not exists presence text not null default 'anwesend';

update public.character_locations
   set presence = 'anwesend'
 where presence is null or presence not in ('anwesend', 'erwaehnt');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'character_locations_presence_chk') then
    alter table public.character_locations
      add constraint character_locations_presence_chk check (presence in ('anwesend', 'erwaehnt'));
  end if;
end
$$;

comment on column public.character_locations.presence is
  'anwesend = on stage (may have start/end place) | erwaehnt = only mentioned (never placed).';
