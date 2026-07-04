-- Lumini Writing — Praemali translator: user lexicon extensions + phrase library.
-- Run this once in the Supabase SQL Editor.
--
-- The BASE lexicon (praemali_lexicon_v2.json) ships with the app as a static
-- asset — it is never stored per user. These tables hold only what the USER
-- adds on top, merged with the base at runtime:
--   custom_lexicon_entries — user-added roots / function words / named entities
--     and `override` entries that shadow a base entry by root key. `payload`
--     has the same JSON shape as the corresponding base lexicon entry, so a
--     base lexicon update can never overwrite or lose user additions.
--   saved_phrases — sentences saved from the Builder (per project), storing
--     the register they were built in plus gloss/translation.
--
-- Both use SOFT delete (deleted_at): a delete syncs across devices as a plain
-- row update through the existing offline queue — no tombstone needed — and
-- list queries filter deleted rows out. project_id is NULLABLE on
-- custom_lexicon_entries: NULL = available in every project.

create table if not exists public.custom_lexicon_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  entry_type text not null check (entry_type in ('root','function_word','named_entity','override')),
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists custom_lexicon_user_id_idx    on public.custom_lexicon_entries (user_id);
create index if not exists custom_lexicon_project_id_idx on public.custom_lexicon_entries (project_id);

create table if not exists public.saved_phrases (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  project_id  uuid references public.projects (id) on delete cascade,
  register    text not null default 'common',
  praemali    text not null,
  gloss       text not null default '',
  translation text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists saved_phrases_user_id_idx    on public.saved_phrases (user_id);
create index if not exists saved_phrases_project_id_idx on public.saved_phrases (project_id);

-- Keep updated_at fresh (reuse set_updated_at() from 0001_init.sql).
drop trigger if exists set_updated_at on public.custom_lexicon_entries;
create trigger set_updated_at before update on public.custom_lexicon_entries
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.saved_phrases;
create trigger set_updated_at before update on public.saved_phrases
  for each row execute function public.set_updated_at();

-- Row Level Security: users read/write only their own rows.
do $$
declare t text;
begin
  foreach t in array array['custom_lexicon_entries','saved_phrases'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (user_id = auth.uid())', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (user_id = auth.uid())', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (user_id = auth.uid())', t, t);
  end loop;
end $$;
