-- SmartWriting — Phase: character portrait images (Supabase Storage)
-- Run this once in the Supabase SQL Editor.
--
-- Creates a PRIVATE bucket for character portraits and RLS policies on
-- storage.objects that scope access to the owning user. Object paths are
-- `{user_id}/{character_id}/{file}`, so the first path segment is the user id;
-- policies allow a user to read/write/delete ONLY objects under their own
-- `{user_id}/` prefix. Images are served to the client via short-lived signed
-- URLs (the bucket is never public). This mirrors the table RLS (auth.uid()).

-- 1) Private bucket (public = false). Re-runnable.
insert into storage.buckets (id, name, public)
values ('character-portraits', 'character-portraits', false)
on conflict (id) do update set public = false;

-- 2) RLS policies on storage.objects, scoped to this bucket and the user whose
--    id is the first folder of the object path. (RLS is already enabled on
--    storage.objects by Supabase.)
drop policy if exists "character_portraits_select" on storage.objects;
drop policy if exists "character_portraits_insert" on storage.objects;
drop policy if exists "character_portraits_update" on storage.objects;
drop policy if exists "character_portraits_delete" on storage.objects;

create policy "character_portraits_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'character-portraits'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "character_portraits_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'character-portraits'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "character_portraits_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'character-portraits'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'character-portraits'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "character_portraits_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'character-portraits'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
