-- Lumini Writing — Phase 3, Stage C: authored ROUTES (named journey lines).
-- Run this once in the Supabase SQL Editor.
--
-- A route is a named, coloured, ORDERED list of places drawn as a line on the
-- map (group journeys / trade roads / a character's planned path). Distinct from
-- the character journeys derived live from character_locations — those need no
-- table. `place_ids` is an ordered JSON array of places.id values.

create table if not exists public.routes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  label      text not null default 'Route',
  place_ids  jsonb not null default '[]'::jsonb, -- ordered array of places.id
  colour     text not null default '#e0b341',
  book       text,                               -- optional book id (project.settings.books[].id)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists routes_user_id_idx    on public.routes (user_id);
create index if not exists routes_project_id_idx on public.routes (project_id);

-- Keep updated_at fresh (reuse set_updated_at() from 0001_init.sql).
drop trigger if exists set_updated_at on public.routes;
create trigger set_updated_at before update on public.routes
  for each row execute function public.set_updated_at();

-- Row Level Security: a user may only touch their own rows.
alter table public.routes enable row level security;

drop policy if exists routes_select on public.routes;
drop policy if exists routes_insert on public.routes;
drop policy if exists routes_update on public.routes;
drop policy if exists routes_delete on public.routes;

create policy routes_select on public.routes
  for select to authenticated using (user_id = auth.uid());
create policy routes_insert on public.routes
  for insert to authenticated with check (user_id = auth.uid());
create policy routes_update on public.routes
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy routes_delete on public.routes
  for delete to authenticated using (user_id = auth.uid());
