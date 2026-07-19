// Field definitions that drive the Characters and Places card views.
// Top-level fields map to real table columns; card fields live in the `card`
// jsonb column (no schema change needed).
import { CHARACTER_ROLES, ROLE_LABELS, SEX_SUGGESTIONS } from '../data/types.js'

export const CHARACTER_CONFIG = {
  kind: 'character',
  singular: 'Figur',
  plural: 'Figuren',
  newName: 'Neue Figur',
  // Shown under the name in the list to give each card a glanceable subtitle.
  // *_region_id keys resolve to the region name (legacy free text as fallback).
  subtitleKeys: ['role', 'origin_region_id'],
  // Portrait gallery at the top of the card (character cards only).
  portrait: true,
  // Per-book life status (card.book_status) + derived current status.
  bookStatus: true,
  // "Aliase / weitere Namen" (card.aliases): the card resolves via #Alias too.
  aliases: true,
  // Subtabs organise the CARDS VIEW only — # autocomplete and metadata
  // selectors always see every character regardless of tier.
  subtabs: [
    { key: 'haupt', label: 'Hauptliste', match: (c) => c.role !== 'randfigur' && c.role !== 'deity' },
    { key: 'rand', label: 'Randfiguren', match: (c) => c.role === 'randfigur' },
    { key: 'pantheon', label: 'Pantheon', match: (c) => c.role === 'deity' },
  ],
  filters: true, // role / derived status / name_final
  topFields: [
    { key: 'role', label: 'Rolle', type: 'select', options: CHARACTER_ROLES, labels: ROLE_LABELS, placeholder: '— Rolle —' },
    // Region dropdown WITH free-text fallback (not every origin is a region).
    // The legacy free-text `origin` stays visible/editable until a region is picked.
    { key: 'origin_region_id', label: 'Herkunft', type: 'region-or-text', legacyKey: 'origin' },
    { key: 'language_name', label: 'Sprachform / Etymologie', type: 'text' },
  ],
  // Compact physical block (stored in `card` jsonb), shown above the narrative
  // fields. `detailFields` are short inputs; `listFields` are repeatable lines;
  // `physicalNotes` are free-text areas.
  detailFields: [
    { key: 'sex', label: 'Geschlecht', suggestions: SEX_SUGGESTIONS, placeholder: 'z. B. männlich' },
    { key: 'age', label: 'Alter', placeholder: 'z. B. „wirkt 30“, „uralt“' },
    { key: 'species', label: 'Spezies' },
    { key: 'height', label: 'Größe', placeholder: 'z. B. „1,85 m“, „hochgewachsen“' },
  ],
  listFields: [
    {
      key: 'recurring_descriptors',
      label: 'Wiederkehrende Beschreibungen',
      placeholder: 'z. B. „markante Nase“, „Narbe über der Braue“',
      hint: 'Kontinuitätshilfe — wie die Figur immer wieder beschrieben wird.',
    },
  ],
  physicalNotes: [
    {
      key: 'habits',
      label: 'Angewohnheiten / Manierismen',
      placeholder: 'z. B. „spielt beim Lügen mit einem Ring“',
    },
  ],
  cardFields: [
    { key: 'who', label: 'Wer sie sind' },
    { key: 'drive', label: 'Was sie antreibt' },
    { key: 'wound', label: 'Wunde / Verlust' },
    { key: 'function', label: 'Funktion in der Geschichte' },
    { key: 'relationships', label: 'Beziehungen' },
    { key: 'secrets', label: 'Geheimnisse (für den Leser noch verborgen)' },
    { key: 'arc_book1', label: 'Bogen — Buch 1' },
    { key: 'arc_book2', label: 'Bogen — Buch 2' },
    { key: 'arc_book3', label: 'Bogen — Buch 3' },
    { key: 'notes', label: 'Notizen' },
  ],
}

export const PLACE_CONFIG = {
  kind: 'place',
  singular: 'Ort',
  plural: 'Orte',
  newName: 'Neuer Ort',
  subtitleKeys: ['place_type', 'region_id'],
  aliases: true,
  topFields: [
    // Dropdown over this project's regions (stored as region_id). Any legacy
    // free-text `region` value stays visible until a region is picked.
    { key: 'region_id', label: 'Region', type: 'region', legacyKey: 'region' },
    { key: 'place_type', label: 'Art des Orts', type: 'text' },
    { key: 'language_name', label: 'Sprachform / Etymologie', type: 'text' },
  ],
  cardFields: [
    { key: 'description', label: 'Kurzbeschreibung' },
    { key: 'atmosphere', label: 'Atmosphäre / Detail' },
    { key: 'significance', label: 'Bedeutung für die Handlung' },
    { key: 'inhabitants', label: 'Wer hier lebt oder herrscht' },
    { key: 'notes', label: 'Notizen' },
  ],
}
