-- Lumini Writing — IDEEN / brainstorming scratchpad.
-- Run this once in the Supabase SQL Editor.
--
-- Quick per-project idea captures: an optional short title, free text content
-- (light Markdown), optional tags for grouping, and a pinned flag that floats
-- an idea to the top of the list. Low-stakes data: sync conflicts resolve by
-- last-write-wins like the other non-prose tables.

create table if not exists public.ideas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title      text not null default '',
  content    text not null default '',
  tags       jsonb not null default '[]'::jsonb, -- array of short tag strings
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ideas_user_id_idx    on public.ideas (user_id);
create index if not exists ideas_project_id_idx on public.ideas (project_id);

-- Keep updated_at fresh (reuse set_updated_at() from 0001_init.sql).
drop trigger if exists set_updated_at on public.ideas;
create trigger set_updated_at before update on public.ideas
  for each row execute function public.set_updated_at();

-- Row Level Security: a user may only touch their own rows.
alter table public.ideas enable row level security;

drop policy if exists ideas_select on public.ideas;
drop policy if exists ideas_insert on public.ideas;
drop policy if exists ideas_update on public.ideas;
drop policy if exists ideas_delete on public.ideas;

create policy ideas_select on public.ideas
  for select to authenticated using (user_id = auth.uid());
create policy ideas_insert on public.ideas
  for insert to authenticated with check (user_id = auth.uid());
create policy ideas_update on public.ideas
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ideas_delete on public.ideas
  for delete to authenticated using (user_id = auth.uid());
