// Field definitions that drive the Characters and Places card views.
// Top-level fields map to real table columns; card fields live in the `card`
// jsonb column (no schema change needed).
import { CHARACTER_ROLES, CHARACTER_LIFE_STATUSES } from '../data/types.js'

export const CHARACTER_CONFIG = {
  kind: 'character',
  singular: 'Figur',
  plural: 'Figuren',
  newName: 'Neue Figur',
  // Shown under the name in the list to give each card a glanceable subtitle.
  subtitleKeys: ['role', 'origin'],
  topFields: [
    { key: 'role', label: 'Rolle', type: 'select', options: CHARACTER_ROLES, placeholder: '— Rolle —' },
    { key: 'origin', label: 'Herkunft', type: 'text' },
    { key: 'language_name', label: 'Sprachform / Etymologie', type: 'text' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      options: CHARACTER_LIFE_STATUSES,
      placeholder: '— Status —',
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
  subtitleKeys: ['place_type', 'region'],
  topFields: [
    { key: 'region', label: 'Region', type: 'text' },
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
