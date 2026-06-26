-- SmartWriting — Phase 2 (events as cards)
-- Run this once in the Supabase SQL Editor.
--
-- The `events` table already exists from 0001_init.sql with:
--   id, user_id, project_id, title, place_id, book, story_order,
--   created_at, updated_at (+ a legacy `description` column), RLS enabled,
--   and the updated_at trigger.
-- This migration only adds the `card` jsonb column used by the Events view to
-- hold: description, involved_character_ids (list), chapter_ids (list), notes.
-- No new RLS is needed — the existing per-user policies on `events` apply.

alter table public.events
  add column if not exists card jsonb not null default '{}'::jsonb;
