-- Lumini Writing — offline/local-first Part 2: deletion TOMBSTONES.
-- Run this once in the Supabase SQL Editor.
--
-- Deletes must propagate across devices without a "pull" being able to see the
-- vanished row. Every delete pushed from a device therefore also records a
-- tombstone here; other devices pull tombstones newer than their cursor and
-- apply the deletion locally — UNLESS the record has locally-unsynced edits,
-- in which case the local copy is kept and the author is notified (a delete
-- must never silently destroy unsynced work).
--
-- project_id has deliberately NO foreign key: a tombstone for a deleted
-- PROJECT must survive the project row itself.

create table if not exists public.tombstones (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null,
  table_name text not null,
  record_id  uuid not null,
  deleted_at timestamptz not null default now()
);
create index if not exists tombstones_user_id_idx    on public.tombstones (user_id);
create index if not exists tombstones_project_id_idx on public.tombstones (project_id, deleted_at);

-- Row Level Security: a user may only touch their own tombstones.
alter table public.tombstones enable row level security;

drop policy if exists tombstones_select on public.tombstones;
drop policy if exists tombstones_insert on public.tombstones;
drop policy if exists tombstones_delete on public.tombstones;

create policy tombstones_select on public.tombstones
  for select to authenticated using (user_id = auth.uid());
create policy tombstones_insert on public.tombstones
  for insert to authenticated with check (user_id = auth.uid());
create policy tombstones_delete on public.tombstones
  for delete to authenticated using (user_id = auth.uid());
