-- Lumini Writing — character status hardening + defensive column re-application.
-- Run this once in the Supabase SQL Editor. Every statement is idempotent.

-- The app's shipped schema has NO check constraint on characters.status (plain
-- text). If your database carries one anyway (added manually or by an older
-- setup), drop it: the column now stores the DERIVED per-book status and must
-- accept 'stirbt' alongside lebt / tot / unbekannt / ''.
alter table public.characters drop constraint if exists characters_status_check;
alter table public.characters drop constraint if exists characters_status_chk;

comment on column public.characters.status is
  'Derived life status (from card.book_status; latest book entry): lebt | stirbt | tot | unbekannt | ''''. Per-book detail lives in card.book_status.';

-- Defensive re-application of the 0013 columns: the sync engine pushes FULL
-- rows, so a database missing these rejects every character/place update
-- ("Could not find the ... column"). Re-running these is a no-op if 0013 ran.
alter table public.regions
  add column if not exists description text not null default '';
alter table public.places
  add column if not exists region_id uuid references public.regions (id) on delete set null;
alter table public.characters
  add column if not exists origin_region_id uuid references public.regions (id) on delete set null;
