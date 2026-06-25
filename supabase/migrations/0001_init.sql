-- SmartWriting — Phase 1b schema + Row Level Security
-- Run this once in the Supabase SQL Editor (or via `supabase db` tooling).
--
-- Security model: every table carries user_id (= auth.users.id). RLS is enabled
-- on every table and policies restrict ALL operations to rows owned by the
-- calling user (user_id = auth.uid()). Inserts must set user_id = auth.uid().
-- The anon key + these policies are the security boundary; the service role
-- key is never used by the client.

-- gen_random_uuid() is available in Supabase by default (pgcrypto).

-- ---------------------------------------------------------------------------
-- Helper: keep updated_at fresh on every UPDATE.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- projects (top-level; no project_id)
-- ===========================================================================
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null default 'Neues Projekt',
  settings    jsonb not null default '{"conlang_enabled": false, "books": []}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists projects_user_id_idx on public.projects (user_id);

-- ===========================================================================
-- chapters
-- ===========================================================================
create table if not exists public.chapters (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  book        uuid,                       -- book id, lives in projects.settings.books
  number      integer not null default 1,
  title       text not null default 'Neues Kapitel',
  version     integer not null default 1,
  status      text not null default 'entwurf'
                check (status in ('entwurf', 'aktiv', 'überarbeitung', 'final')),
  pov         text not null default '',
  summary     text not null default '',
  body        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists chapters_user_id_idx    on public.chapters (user_id);
create index if not exists chapters_project_id_idx on public.chapters (project_id);

-- ===========================================================================
-- characters
-- ===========================================================================
create table if not exists public.characters (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  project_id    uuid not null references public.projects (id) on delete cascade,
  name          text not null default 'Namenlos',
  name_final    boolean not null default false,
  role          text not null default '',
  origin        text not null default '',
  language_name text not null default '',
  status        text not null default '',
  card          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists characters_user_id_idx    on public.characters (user_id);
create index if not exists characters_project_id_idx on public.characters (project_id);

-- ===========================================================================
-- places
-- ===========================================================================
create table if not exists public.places (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  project_id    uuid not null references public.projects (id) on delete cascade,
  name          text not null default 'Unbenannter Ort',
  name_final    boolean not null default false,
  region        text not null default '',
  place_type    text not null default '',
  language_name text not null default '',
  coords        jsonb,                    -- 3D position, set in Phase 3
  card          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists places_user_id_idx    on public.places (user_id);
create index if not exists places_project_id_idx on public.places (project_id);

-- ===========================================================================
-- character_locations (timeline backbone)
--   character_id set, place_id null -> character present, location unset
--   character_id set, place_id set  -> character present at place
--   character_id null, place_id set -> place present in chapter (no character)
-- ===========================================================================
create table if not exists public.character_locations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  project_id    uuid not null references public.projects (id) on delete cascade,
  chapter_id    uuid not null references public.chapters (id) on delete cascade,
  character_id  uuid references public.characters (id) on delete cascade,
  place_id      uuid references public.places (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists charloc_user_id_idx    on public.character_locations (user_id);
create index if not exists charloc_project_id_idx on public.character_locations (project_id);
create index if not exists charloc_chapter_id_idx on public.character_locations (chapter_id);

-- ===========================================================================
-- Deferred tables (created now for a complete schema; NOT used by the UI yet).
-- ===========================================================================
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  title       text not null default '',
  description text not null default '',
  place_id    uuid references public.places (id) on delete set null,
  book        uuid,
  story_order integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists events_user_id_idx    on public.events (user_id);
create index if not exists events_project_id_idx on public.events (project_id);

create table if not exists public.routes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  project_id      uuid not null references public.projects (id) on delete cascade,
  label           text not null default '',
  ordered_place_ids jsonb not null default '[]'::jsonb,
  book            uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists routes_user_id_idx    on public.routes (user_id);
create index if not exists routes_project_id_idx on public.routes (project_id);

create table if not exists public.lexicon (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  root        text not null default '',
  meaning     text not null default '',
  register    text not null default '',
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists lexicon_user_id_idx    on public.lexicon (user_id);
create index if not exists lexicon_project_id_idx on public.lexicon (project_id);

-- ===========================================================================
-- updated_at triggers
-- ===========================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'projects','chapters','characters','places','character_locations',
    'events','routes','lexicon'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I;', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at();', t);
  end loop;
end;
$$;

-- ===========================================================================
-- Row Level Security: enable + per-operation policies on EVERY table.
-- Each policy restricts access to rows the caller owns (user_id = auth.uid()).
-- ===========================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'projects','chapters','characters','places','character_locations',
    'events','routes','lexicon'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);

    -- Drop any prior copies so this migration is re-runnable.
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);

    execute format(
      'create policy %I_select on public.%I
         for select to authenticated
         using (user_id = auth.uid());', t, t);

    execute format(
      'create policy %I_insert on public.%I
         for insert to authenticated
         with check (user_id = auth.uid());', t, t);

    execute format(
      'create policy %I_update on public.%I
         for update to authenticated
         using (user_id = auth.uid())
         with check (user_id = auth.uid());', t, t);

    execute format(
      'create policy %I_delete on public.%I
         for delete to authenticated
         using (user_id = auth.uid());', t, t);
  end loop;
end;
$$;
