-- Lumini Writing — Phase 3: map REGIONS layer.
-- Run this once in the Supabase SQL Editor.
--
-- Two parts:
--   1. `regions` — per-project named, coloured areas (definitions only).
--   2. `terrains.regions` — an OPTIONAL per-cell assignment byte array, mirroring
--      the existing `terrain_types` layer. Each byte is a "region slot" (0 =
--      unassigned); the slot → region-id map lives in `terrains.settings`
--      (region_slots), so region ids never bloat the per-cell blob and a region
--      rename/recolour touches only the small definition row.

create table if not exists public.regions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name       text not null default 'Region',
  colour     text not null default '#e0b341',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists regions_user_id_idx    on public.regions (user_id);
create index if not exists regions_project_id_idx on public.regions (project_id);

-- Keep updated_at fresh (reuse set_updated_at() from 0001_init.sql).
drop trigger if exists set_updated_at on public.regions;
create trigger set_updated_at before update on public.regions
  for each row execute function public.set_updated_at();

-- Row Level Security: a user may only touch their own rows.
alter table public.regions enable row level security;

drop policy if exists regions_select on public.regions;
drop policy if exists regions_insert on public.regions;
drop policy if exists regions_update on public.regions;
drop policy if exists regions_delete on public.regions;

create policy regions_select on public.regions
  for select to authenticated using (user_id = auth.uid());
create policy regions_insert on public.regions
  for insert to authenticated with check (user_id = auth.uid());
create policy regions_update on public.regions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy regions_delete on public.regions
  for delete to authenticated using (user_id = auth.uid());

-- Per-cell region assignment: base64(Uint8Array), one slot byte per cell
-- (0 = unassigned). NULL until the author paints any region. The slot → region
-- id map lives in terrains.settings.region_slots (jsonb, no schema change).
alter table public.terrains add column if not exists regions text;
