-- Lumini Writing — chapter versioning (PROSE only)
-- Run this once in the Supabase SQL Editor.
--
-- Design: a chapter stays ONE logical row holding ALL metadata (status, pov,
-- summary, etc.) and is the anchor for character_locations, event links and
-- #Name references. Only the BODY is versioned, in `chapter_versions`. The
-- chapter points to its active version via `active_version_id`, and
-- `chapters.body` is kept as a MIRROR of the active version's body so existing
-- reads (editor, export, #ref scanning) keep working unchanged.

-- ---------------------------------------------------------------------------
-- chapter_versions: per-version body text only.
-- ---------------------------------------------------------------------------
create table if not exists public.chapter_versions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  project_id     uuid not null references public.projects (id) on delete cascade,
  chapter_id     uuid not null references public.chapters (id) on delete cascade,
  version_number integer not null default 1,
  label          text not null default '',
  body           text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists chapter_versions_user_id_idx    on public.chapter_versions (user_id);
create index if not exists chapter_versions_project_id_idx on public.chapter_versions (project_id);
create index if not exists chapter_versions_chapter_id_idx on public.chapter_versions (chapter_id);

-- The chapter's active (live) version. ON DELETE SET NULL is a safety net; the
-- app forbids deleting the active version.
alter table public.chapters
  add column if not exists active_version_id uuid
  references public.chapter_versions (id) on delete set null;

-- Keep updated_at fresh (reuse set_updated_at() from 0001_init.sql).
drop trigger if exists set_updated_at on public.chapter_versions;
create trigger set_updated_at before update on public.chapter_versions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: a user may only touch their own rows.
-- ---------------------------------------------------------------------------
alter table public.chapter_versions enable row level security;

drop policy if exists chapter_versions_select on public.chapter_versions;
drop policy if exists chapter_versions_insert on public.chapter_versions;
drop policy if exists chapter_versions_update on public.chapter_versions;
drop policy if exists chapter_versions_delete on public.chapter_versions;

create policy chapter_versions_select on public.chapter_versions
  for select to authenticated using (user_id = auth.uid());
create policy chapter_versions_insert on public.chapter_versions
  for insert to authenticated with check (user_id = auth.uid());
create policy chapter_versions_update on public.chapter_versions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy chapter_versions_delete on public.chapter_versions
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Backfill (lose no text): every chapter without an active version gets a
-- "Version 1" copying its current body, set as active. Re-runnable.
-- ---------------------------------------------------------------------------
do $$
declare
  ch record;
  v_id uuid;
begin
  for ch in
    select id, project_id, user_id, body from public.chapters where active_version_id is null
  loop
    insert into public.chapter_versions
      (chapter_id, project_id, user_id, version_number, label, body)
      values (ch.id, ch.project_id, ch.user_id, 1, 'Version 1', coalesce(ch.body, ''))
      returning id into v_id;
    update public.chapters set active_version_id = v_id where id = ch.id;
  end loop;
end $$;
