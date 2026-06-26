import { useMemo } from 'react'
import { useStore } from '../state/store.jsx'
import { CHAPTER_STATUSES } from '../data/types.js'
import AddCombo from './AddCombo.jsx'

// Per-chapter metadata. Characters and places present are now SELECTED from the
// project's cards (storing ids, never names). Each present character gets a
// place dropdown (limited to present places) that writes a character_locations
// row (project_id, character_id, chapter_id, place_id).
export default function MetadataPanel({ chapter }) {
  const {
    characters,
    places,
    locations,
    updateChapter,
    createCharacter,
    createPlace,
    setCharacterPresent,
    setCharacterPlace,
    setPlacePresent,
  } = useStore()

  const chapterLocs = useMemo(
    () => locations.filter((l) => l.chapter_id === chapter.id),
    [locations, chapter.id],
  )
  const presentCharIds = chapterLocs.filter((l) => l.character_id).map((l) => l.character_id)
  const presentPlaceIds = chapterLocs.filter((l) => l.place_id).map((l) => l.place_id)
  const presentCharSet = new Set(presentCharIds)
  const presentPlaceSet = new Set(presentPlaceIds)

  const byId = (list, id) => list.find((x) => x.id === id)
  const charPlaceId = (charId) =>
    chapterLocs.find((l) => l.character_id === charId)?.place_id || ''

  // Present characters as full card objects, in name order.
  const presentCharacters = presentCharIds
    .map((id) => byId(characters, id))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
  // Present places (no bound character or any) — distinct place cards.
  const presentPlaces = [...presentPlaceSet]
    .map((id) => byId(places, id))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))

  const unselectedCharacters = characters.filter((c) => !presentCharSet.has(c.id))
  const unselectedPlaces = places.filter((p) => !presentPlaceSet.has(p.id))

  // Place options for a character's location dropdown: the present places, plus
  // the character's current place if it is no longer marked present.
  function placeOptionsFor(charId) {
    const opts = [...presentPlaces]
    const cur = charPlaceId(charId)
    if (cur && !presentPlaceSet.has(cur)) {
      const p = byId(places, cur)
      if (p) opts.push(p)
    }
    return opts
  }

  async function pickCharacter(id) {
    await setCharacterPresent(chapter.id, id, true)
  }
  async function createCharacterPresent(name) {
    const c = await createCharacter(name)
    if (c) await setCharacterPresent(chapter.id, c.id, true)
  }
  async function pickPlace(id) {
    await setPlacePresent(chapter.id, id, true)
  }
  async function createPlacePresent(name) {
    const p = await createPlace(name)
    if (p) await setPlacePresent(chapter.id, p.id, true)
  }
  // Removing a present place also clears it from any character located there
  // this chapter (a place can be "present" purely via a character location).
  async function removePlace(placeId) {
    for (const c of presentCharacters) {
      if (charPlaceId(c.id) === placeId) await setCharacterPlace(chapter.id, c.id, null)
    }
    await setPlacePresent(chapter.id, placeId, false)
  }

  return (
    <div className="meta-panel">
      <h3>Kapitel-Metadaten</h3>

      <label className="field">
        <span>Status</span>
        <select
          value={chapter.status}
          onChange={(e) => updateChapter(chapter.id, { status: e.target.value })}
        >
          {CHAPTER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>POV (Perspektive)</span>
        <input
          type="text"
          value={chapter.pov}
          placeholder="Erzählperspektive …"
          onChange={(e) => updateChapter(chapter.id, { pov: e.target.value })}
        />
      </label>

      <label className="field">
        <span>Zusammenfassung (eine Zeile)</span>
        <input
          type="text"
          value={chapter.summary}
          placeholder="Worum geht es in diesem Kapitel?"
          onChange={(e) => updateChapter(chapter.id, { summary: e.target.value })}
        />
      </label>

      {/* Characters present ------------------------------------------------ */}
      <div className="field">
        <div className="field-head">
          <span>Anwesende Figuren</span>
        </div>
        <AddCombo
          placeholder="Figur suchen oder anlegen …"
          options={unselectedCharacters}
          onPick={pickCharacter}
          onCreate={createCharacterPresent}
        />
        {presentCharacters.length === 0 ? (
          <p className="hint">Keine Figuren in diesem Kapitel.</p>
        ) : (
          <ul className="present-list">
            {presentCharacters.map((c) => (
              <li key={c.id} className="present-item">
                <div className="present-row">
                  <span className="present-name">
                    {c.name}
                    {!c.name_final && <span className="badge provisional small">prov.</span>}
                  </span>
                  <button
                    className="icon-btn"
                    title="Aus Kapitel entfernen"
                    onClick={() => setCharacterPresent(chapter.id, c.id, false)}
                  >
                    ✕
                  </button>
                </div>
                <select
                  className="loc-select"
                  value={charPlaceId(c.id)}
                  onChange={(e) => setCharacterPlace(chapter.id, c.id, e.target.value || null)}
                  title="Wo ist die Figur in diesem Kapitel?"
                >
                  <option value="">— Ort wählen —</option>
                  {placeOptionsFor(c.id).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Places present ---------------------------------------------------- */}
      <div className="field">
        <div className="field-head">
          <span>Anwesende Orte</span>
        </div>
        <AddCombo
          placeholder="Ort suchen oder anlegen …"
          options={unselectedPlaces}
          onPick={pickPlace}
          onCreate={createPlacePresent}
        />
        {presentPlaces.length === 0 ? (
          <p className="hint">Keine Orte in diesem Kapitel.</p>
        ) : (
          <ul className="chip-list">
            {presentPlaces.map((p) => (
              <li key={p.id} className="chip">
                <span>
                  {p.name}
                  {!p.name_final && <span className="badge provisional small">prov.</span>}
                </span>
                <button
                  className="chip-remove"
                  title="Aus Kapitel entfernen"
                  onClick={() => removePlace(p.id)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
