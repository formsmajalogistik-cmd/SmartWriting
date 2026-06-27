-- Lumini Writing — Phase 3, Stage A: per-project tile-grid terrain.
-- Run this once in the Supabase SQL Editor.
--
-- One terrain per project: a fixed-size grid of cells, each with a discrete
-- height step. Land is whatever rises above `sea_level`; coastlines emerge from
-- which cells are raised (there is NO external heightmap). Per-cell heights are
-- stored as a compact base64-encoded byte array (one byte per cell, row-major),
-- so a 96×96 grid is a single ~12 KB string instead of thousands of rows.
--
-- `terrain_types` is an OPTIONAL parallel byte array for manual colour
-- overrides per cell (auto-colour by height band needs no data). It is nullable
-- so the height-band colouring works with zero per-cell type data; a later
-- stage can paint into it without a schema change.
--
-- Forward-compatible with later Stage-B/C work (markers, timeline, routes):
-- those read places.coords / character_locations and simply sit ON this
-- terrain — they do not change this table.

create table if not exists public.terrains (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  project_id    uuid not null references public.projects (id) on delete cascade,
  width         integer not null,
  height        integer not null,
  sea_level     integer not null default 2,
  -- base64(Uint8Array) of per-cell height steps, length = width*height.
  heights       text not null default '',
  -- base64(Uint8Array) of per-cell terrain-type ids, or NULL = auto-colour only.
  terrain_types text,
  -- rendering params: { maxHeight, step, cellSize, encoding }.
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- One terrain per project (Stage A has no multi-map support yet).
  unique (project_id)
);
create index if not exists terrains_user_id_idx    on public.terrains (user_id);
create index if not exists terrains_project_id_idx on public.terrains (project_id);

-- Keep updated_at fresh (reuse set_updated_at() from 0001_init.sql).
drop trigger if exists set_updated_at on public.terrains;
create trigger set_updated_at before update on public.terrains
  for each row execute function public.set_updated_at();

-- Row Level Security: a user may only touch their own rows.
alter table public.terrains enable row level security;

drop policy if exists terrains_select on public.terrains;
drop policy if exists terrains_insert on public.terrains;
drop policy if exists terrains_update on public.terrains;
drop policy if exists terrains_delete on public.terrains;

create policy terrains_select on public.terrains
  for select to authenticated using (user_id = auth.uid());
create policy terrains_insert on public.terrains
  for insert to authenticated with check (user_id = auth.uid());
create policy terrains_update on public.terrains
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy terrains_delete on public.terrains
  for delete to authenticated using (user_id = auth.uid());
