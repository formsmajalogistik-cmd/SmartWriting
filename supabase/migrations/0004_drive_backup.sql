-- SmartWriting — Phase: per-user Google Drive backup linkage
-- Run this once in the Supabase SQL Editor.
--
-- Stores, PER USER, the opt-in flag and the Drive folder/file IDs needed so
-- repeat backups UPDATE the same files instead of duplicating. One row per
-- user (user_id is the primary key). RLS restricts every operation to the
-- owning user, so one user's Drive linkage is never visible or usable by
-- another.
--
-- SECURITY: NO OAuth tokens are stored here. Access tokens are short-lived and
-- kept only in memory in the browser. The client uses only the public Google
-- OAuth Client ID and the least-privilege `drive.file` scope.

create table if not exists public.drive_backup (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  connected      boolean not null default false,
  root_folder_id text,
  -- { [project_id]: { folder_id, folders: {<dir>: id}, files: {<path>: id}, last_backup_at } }
  links          jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Reuse the set_updated_at() trigger function created in 0001_init.sql.
drop trigger if exists set_updated_at on public.drive_backup;
create trigger set_updated_at before update on public.drive_backup
  for each row execute function public.set_updated_at();

-- Row Level Security: a user may only touch their own row.
alter table public.drive_backup enable row level security;

drop policy if exists drive_backup_select on public.drive_backup;
drop policy if exists drive_backup_insert on public.drive_backup;
drop policy if exists drive_backup_update on public.drive_backup;
drop policy if exists drive_backup_delete on public.drive_backup;

create policy drive_backup_select on public.drive_backup
  for select to authenticated using (user_id = auth.uid());
create policy drive_backup_insert on public.drive_backup
  for insert to authenticated with check (user_id = auth.uid());
create policy drive_backup_update on public.drive_backup
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy drive_backup_delete on public.drive_backup
  for delete to authenticated using (user_id = auth.uid());
