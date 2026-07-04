-- Lumini Writing — Praemali phrase library addendum: manual entry + paste-import.
-- Run this once in the Supabase SQL Editor.
--
-- Extends saved_phrases for the paste-based corpus workflow:
--   translation_de — German meaning (the existing `translation` column holds EN)
--   tags           — jsonb array of free tag strings
--   unresolved     — jsonb array of tokens the validation pass could not find in
--                    the merged lexicon (flags persist with the phrase and are
--                    cleared by re-validation once the word is added)

alter table public.saved_phrases
  add column if not exists translation_de text not null default '',
  add column if not exists tags jsonb not null default '[]'::jsonb,
  add column if not exists unresolved jsonb not null default '[]'::jsonb;
