-- ===========================================================================
-- 0019 — CHRONIK: the in-universe timeline (timeline_entries)
--
-- One row per dated piece of world history. Dating is RELATIVE to the story:
-- year_offset = whole years relative to the START of Book 1 (0 = Beginn Buch 1,
-- negative = before, positive = after). Later books get their own start offset
-- in projects.settings.bookYearOffsets (no schema needed).
--
--   year_precision  'exakt' | 'ungefaehr' | 'jahrzehnt' | 'jahrhundert'
--                   — shown honestly ("~200 Jahre vor Buch 1",
--                     "im 3. Jahrhundert vor Buch 1"); never as false precision.
--   duration_years  NULL = a point in time; >= 0 = a span (rendered as a bar).
--   era_label       optional; all entries sharing a label form an era band.
--   visibility      'oeffentlich' (öffentlich bekannt) | 'verborgen' — e.g.
--                   history the characters (and readers) don't know yet.
--
-- ONE SOURCE OF TRUTH: an entry may reference an existing event (event_id)
-- instead of copying it — title, description, involved characters and place
-- then come from the event. Entries without an event are allowed for history
-- that never appears in a chapter.
--
-- related_*_ids are jsonb arrays of ids (like ideas.tags): a deleted character,
-- place or region simply drops out of the display; no FK can wedge a push.
-- Machine values are ASCII (no umlauts) so no Unicode normalisation can split a
-- value; the UI shows the German labels.
-- ===========================================================================

create table if not exists public.timeline_entries (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  project_id            uuid not null references public.projects (id) on delete cascade,
  title                 text not null default '',
  description           text not null default '',
  year_offset           integer not null default 0,
  year_precision        text not null default 'exakt',
  duration_years        integer,
  era_label             text not null default '',
  related_character_ids jsonb not null default '[]'::jsonb,
  related_place_ids     jsonb not null default '[]'::jsonb,
  related_region_ids    jsonb not null default '[]'::jsonb,
  event_id              uuid references public.events (id) on delete set null,
  visibility            text not null default 'oeffentlich',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Additive and idempotent: if an earlier, partial version of the table exists,
-- these bring it up to date instead of relying on CREATE TABLE IF NOT EXISTS.
alter table public.timeline_entries
  add column if not exists user_id               uuid references auth.users (id) on delete cascade,
  add column if not exists project_id            uuid references public.projects (id) on delete cascade,
  add column if not exists title                 text not null default '',
  add column if not exists description           text not null default '',
  add column if not exists year_offset           integer not null default 0,
  add column if not exists year_precision        text not null default 'exakt',
  add column if not exists duration_years        integer,
  add column if not exists era_label             text not null default '',
  add column if not exists related_character_ids jsonb not null default '[]'::jsonb,
  add column if not exists related_place_ids     jsonb not null default '[]'::jsonb,
  add column if not exists related_region_ids    jsonb not null default '[]'::jsonb,
  add column if not exists event_id              uuid references public.events (id) on delete set null,
  add column if not exists visibility            text not null default 'oeffentlich',
  add column if not exists created_at            timestamptz not null default now(),
  add column if not exists updated_at            timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'timeline_entries_precision_chk') then
    alter table public.timeline_entries add constraint timeline_entries_precision_chk
      check (year_precision in ('exakt', 'ungefaehr', 'jahrzehnt', 'jahrhundert'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'timeline_entries_visibility_chk') then
    alter table public.timeline_entries add constraint timeline_entries_visibility_chk
      check (visibility in ('oeffentlich', 'verborgen'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'timeline_entries_duration_chk') then
    alter table public.timeline_entries add constraint timeline_entries_duration_chk
      check (duration_years is null or duration_years >= 0);
  end if;
end
$$;

create index if not exists timeline_entries_user_id_idx    on public.timeline_entries (user_id);
create index if not exists timeline_entries_project_id_idx on public.timeline_entries (project_id);
create index if not exists timeline_entries_event_id_idx   on public.timeline_entries (event_id);
create index if not exists timeline_entries_order_idx      on public.timeline_entries (project_id, year_offset);

-- Keep updated_at fresh (reuse set_updated_at() from 0001_init.sql).
drop trigger if exists set_updated_at on public.timeline_entries;
create trigger set_updated_at before update on public.timeline_entries
  for each row execute function public.set_updated_at();

-- Row Level Security: a user may only touch their own rows.
alter table public.timeline_entries enable row level security;

drop policy if exists timeline_entries_select on public.timeline_entries;
drop policy if exists timeline_entries_insert on public.timeline_entries;
drop policy if exists timeline_entries_update on public.timeline_entries;
drop policy if exists timeline_entries_delete on public.timeline_entries;

create policy timeline_entries_select on public.timeline_entries
  for select to authenticated using (user_id = auth.uid());
create policy timeline_entries_insert on public.timeline_entries
  for insert to authenticated with check (user_id = auth.uid());
create policy timeline_entries_update on public.timeline_entries
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy timeline_entries_delete on public.timeline_entries
  for delete to authenticated using (user_id = auth.uid());
