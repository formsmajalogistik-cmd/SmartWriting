-- Lumini Writing — NAMENSPOOL: a per-project reservoir of names for minor and
-- background characters ("Namen" view → subtab "Namenspool").
-- Run this once in the Supabase SQL Editor.
--
-- One row per available name. A name is scoped to a project (other projects are
-- other worlds) and carries where it belongs (region_id when it matches a real
-- region card, otherwise the free text it was imported with), which gender it
-- reads as, what KIND of name it is (Vorname / Verdienter Name / Patronym /
-- Praemali-Patronym …), optional role tags, notes, and a `hidden` flag for
-- names that should never be suggested again.
--
-- Deliberately NOT stored: whether a name is "used". That is derived LIVE from
-- the project's character cards (name or alias, case-insensitively), so
-- deleting a character returns its name to the pool by itself.
--
-- No UNIQUE constraint on (project_id, name): the same name may legitimately
-- exist for two regions, and a hard constraint would turn a two-device import
-- race into a permanently stuck push. Import de-duplication happens in the app
-- (per project + name + region, case-insensitively), which is idempotent.

create table if not exists public.name_pool (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null default '',
  region_id   uuid references public.regions (id) on delete set null,
  region_text text not null default '',        -- fallback when no region card matches
  gender      text not null default 'neutral', -- männlich | weiblich | neutral
  category    text not null default 'Vorname', -- Vorname | Verdienter Name (Titel) | Patronym | Praemali-Patronym (-tam) | …
  tags        jsonb not null default '[]'::jsonb, -- role tags: Wache/Soldat, Priester/Gelehrter, Kind, Alt …
  notes       text not null default '',
  hidden      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Additive and idempotent: if an earlier partial version of the table exists,
-- these bring it up to date instead of relying on CREATE TABLE IF NOT EXISTS.
alter table public.name_pool
  add column if not exists user_id     uuid references auth.users (id) on delete cascade,
  add column if not exists project_id  uuid references public.projects (id) on delete cascade,
  add column if not exists name        text not null default '',
  add column if not exists region_id   uuid references public.regions (id) on delete set null,
  add column if not exists region_text text not null default '',
  add column if not exists gender      text not null default 'neutral',
  add column if not exists category    text not null default 'Vorname',
  add column if not exists tags        jsonb not null default '[]'::jsonb,
  add column if not exists notes       text not null default '',
  add column if not exists hidden      boolean not null default false,
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now();

create index if not exists name_pool_user_id_idx    on public.name_pool (user_id);
create index if not exists name_pool_project_id_idx on public.name_pool (project_id);
create index if not exists name_pool_region_id_idx  on public.name_pool (region_id);
-- Case-insensitive lookup of a name within a project (import de-duplication).
create index if not exists name_pool_project_name_idx on public.name_pool (project_id, lower(name));

-- Keep updated_at fresh (reuse set_updated_at() from 0001_init.sql).
drop trigger if exists set_updated_at on public.name_pool;
create trigger set_updated_at before update on public.name_pool
  for each row execute function public.set_updated_at();

-- Row Level Security: a user may only touch their own rows.
alter table public.name_pool enable row level security;

drop policy if exists name_pool_select on public.name_pool;
drop policy if exists name_pool_insert on public.name_pool;
drop policy if exists name_pool_update on public.name_pool;
drop policy if exists name_pool_delete on public.name_pool;

create policy name_pool_select on public.name_pool
  for select to authenticated using (user_id = auth.uid());
create policy name_pool_insert on public.name_pool
  for insert to authenticated with check (user_id = auth.uid());
create policy name_pool_update on public.name_pool
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy name_pool_delete on public.name_pool
  for delete to authenticated using (user_id = auth.uid());

-- The editable collision-prefix list lives in projects.settings
-- (settings.namePoolPrefixes, a jsonb array of strings) — no schema change.
