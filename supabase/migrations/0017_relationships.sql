-- Lumini Writing — CHARACTER RELATIONSHIPS (Beziehungen).
-- Run this once in the Supabase SQL Editor.
--
-- One row per relationship, never two: the row records the fact in ONE
-- direction and the app presents the correct counterpart on the other
-- character's card.
--   • SYMMETRIC types (Geschwister, Ehepartner, Partner, Freund, Rivale, Feind,
--     Verbündeter) read the same from both sides.
--   • DIRECTIONAL types carry an inverse: Elternteil → Kind, Mentor → Schüler,
--     Herr → Dienender. `from_character_id` is always the first-named side
--     (the Elternteil / Mentor / Herr).
-- Family relations beyond the entered ones (Großeltern, Enkel, Tante/Onkel,
-- Nichte/Neffe, Cousine/Cousin, Schwager/Schwägerin, Schwiegereltern,
-- Schwiegerkind and siblings that share a parent) are DERIVED from the
-- parent/child chain at read time — never stored.
--
-- started_book / ended_book hold a book id from projects.settings.books (uuid,
-- like chapters.book) so a relationship can be dated to the story's timeline.
-- `uncertain` marks a relationship as unsicher/geheim: it lives in the notes
-- without being asserted as public fact (e.g. an unrevealed parentage).
--
-- No UNIQUE constraint on (project_id, from, to, type): duplicates are
-- prevented in the app, and a hard constraint would turn two devices entering
-- the same fact into a permanently stuck push. The self-relationship CHECK is
-- safe that way — no legitimate row can ever violate it.

create table if not exists public.relationships (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  project_id        uuid not null references public.projects (id) on delete cascade,
  from_character_id uuid not null references public.characters (id) on delete cascade,
  to_character_id   uuid not null references public.characters (id) on delete cascade,
  type              text not null default 'freund',
  note              text not null default '',
  started_book      uuid,                        -- book id (projects.settings.books)
  ended_book        uuid,
  uncertain         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Additive and idempotent: brings an earlier partial table up to date instead
-- of relying on CREATE TABLE IF NOT EXISTS.
alter table public.relationships
  add column if not exists user_id           uuid references auth.users (id) on delete cascade,
  add column if not exists project_id        uuid references public.projects (id) on delete cascade,
  add column if not exists from_character_id uuid references public.characters (id) on delete cascade,
  add column if not exists to_character_id   uuid references public.characters (id) on delete cascade,
  add column if not exists type              text not null default 'freund',
  add column if not exists note              text not null default '',
  add column if not exists started_book      uuid,
  add column if not exists ended_book        uuid,
  add column if not exists uncertain         boolean not null default false,
  add column if not exists created_at        timestamptz not null default now(),
  add column if not exists updated_at        timestamptz not null default now();

-- No self-relationships, at the database level too.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'relationships_no_self') then
    alter table public.relationships
      add constraint relationships_no_self check (from_character_id <> to_character_id);
  end if;
end
$$;

create index if not exists relationships_user_id_idx    on public.relationships (user_id);
create index if not exists relationships_project_id_idx on public.relationships (project_id);
create index if not exists relationships_from_idx       on public.relationships (from_character_id);
create index if not exists relationships_to_idx         on public.relationships (to_character_id);

-- Keep updated_at fresh (reuse set_updated_at() from 0001_init.sql).
drop trigger if exists set_updated_at on public.relationships;
create trigger set_updated_at before update on public.relationships
  for each row execute function public.set_updated_at();

-- Row Level Security: a user may only touch their own rows.
alter table public.relationships enable row level security;

drop policy if exists relationships_select on public.relationships;
drop policy if exists relationships_insert on public.relationships;
drop policy if exists relationships_update on public.relationships;
drop policy if exists relationships_delete on public.relationships;

create policy relationships_select on public.relationships
  for select to authenticated using (user_id = auth.uid());
create policy relationships_insert on public.relationships
  for insert to authenticated with check (user_id = auth.uid());
create policy relationships_update on public.relationships
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy relationships_delete on public.relationships
  for delete to authenticated using (user_id = auth.uid());

-- Deleting a character removes its relationships (ON DELETE CASCADE above).
