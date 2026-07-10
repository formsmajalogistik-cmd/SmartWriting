-- Lumini Writing — world entities: regions as first-class entities + geo features.
-- Run this once in the Supabase SQL Editor.

-- 1) Regions get an optional short description (for #link previews). Additive
--    ALTERs — never CREATE TABLE IF NOT EXISTS for column additions.
alter table public.regions
  add column if not exists description text not null default '';

-- 2) Place cards reference a region by id (the old free-text `region` column
--    stays for graceful migration — shown until a region is picked).
alter table public.places
  add column if not exists region_id uuid references public.regions (id) on delete set null;

-- 3) Character origin can reference a region by id, with the old free-text
--    `origin` column as fallback (some origins aren't regions).
alter table public.characters
  add column if not exists origin_region_id uuid references public.regions (id) on delete set null;

-- 4) Geo features: named geography (river / forest / mountain range / lake …)
--    that is NOT a place card but appears as a text label on the map and is
--    #-linkable. coords = {col,row} grid position like places.coords.
create table if not exists public.geo_features (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  name         text not null default 'Neues Merkmal',
  feature_type text not null default 'sonstiges', -- fluss | wald | gebirge | see | sonstiges
  description  text not null default '',
  coords       jsonb,                             -- {col,row} | null = not on the map yet
  label_size   text not null default 'm',         -- s | m | l
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists geo_features_user_id_idx    on public.geo_features (user_id);
create index if not exists geo_features_project_id_idx on public.geo_features (project_id);

drop trigger if exists set_updated_at on public.geo_features;
create trigger set_updated_at before update on public.geo_features
  for each row execute function public.set_updated_at();

alter table public.geo_features enable row level security;

drop policy if exists geo_features_select on public.geo_features;
drop policy if exists geo_features_insert on public.geo_features;
drop policy if exists geo_features_update on public.geo_features;
drop policy if exists geo_features_delete on public.geo_features;

create policy geo_features_select on public.geo_features
  for select to authenticated using (user_id = auth.uid());
create policy geo_features_insert on public.geo_features
  for insert to authenticated with check (user_id = auth.uid());
create policy geo_features_update on public.geo_features
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy geo_features_delete on public.geo_features
  for delete to authenticated using (user_id = auth.uid());
