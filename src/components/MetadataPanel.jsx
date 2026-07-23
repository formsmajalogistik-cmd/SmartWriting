import { useEffect, useMemo, useRef } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { CHAPTER_STATUSES } from '../data/types.js'
import { countWords } from '../lib/progress.js'
import AddCombo from './AddCombo.jsx'

// Per-chapter metadata. Characters and places present are SELECTED from the
// project's cards (storing ids, never names). Each present character gets a
// START place ("von") and an optional END place ("bis") — both written to its
// character_locations row (place_id / end_place_id). Empty end = no movement.
export default function MetadataPanel({ chapter }) {
  const {
    characters,
    places,
    locations,
    events,
    updateChapter,
    createCharacter,
    createPlace,
    createEvent,
    setEventInChapter,
    openCard,
    setCharacterPresent,
    setCharacterPlace,
    setCharacterEndPlace,
    setPlacePresent,
  } = useStore()

  // Auto-growing summary: match the height to the content (bounded; scrolls
  // beyond the max) so the whole text stays visible while writing.
  const summaryRef = useRef(null)
  useEffect(() => {
    const el = summaryRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, 220)}px`
  }, [chapter.summary, chapter.id])

  const chapterLocs = useMemo(
    () => locations.filter((l) => l.chapter_id === chapter.id),
    [locations, chapter.id],
  )
  const presentCharIds = chapterLocs.filter((l) => l.character_id).map((l) => l.character_id)
  // A place counts as present when anything references it — as a plain present
  // place, a character's start place, or a character's END place.
  const presentPlaceIds = chapterLocs.flatMap((l) => [l.place_id, l.end_place_id]).filter(Boolean)
  const presentCharSet = new Set(presentCharIds)
  const presentPlaceSet = new Set(presentPlaceIds)

  const byId = (list, id) => list.find((x) => x.id === id)
  const charLoc = (charId) => chapterLocs.find((l) => l.character_id === charId)
  const charPlaceId = (charId) => charLoc(charId)?.place_id || ''
  const charEndPlaceId = (charId) => charLoc(charId)?.end_place_id || ''

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

  // Place options for a character's location dropdowns: the present places,
  // plus the character's current start/end places if no longer marked present.
  function placeOptionsFor(charId) {
    const opts = [...presentPlaces]
    for (const cur of [charPlaceId(charId), charEndPlaceId(charId)]) {
      if (cur && !opts.some((p) => p.id === cur)) {
        const p = byId(places, cur)
        if (p) opts.push(p)
      }
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

  // Events whose card.chapter_ids includes this chapter (two-way link).
  const chapterEvents = events.filter((e) =>
    (e.card?.chapter_ids ?? []).includes(chapter.id),
  )
  const unselectedEvents = events.filter(
    (e) => !(e.card?.chapter_ids ?? []).includes(chapter.id),
  )
  async function pickEvent(id) {
    await setEventInChapter(id, chapter.id, true)
  }
  async function createEventPresent(title) {
    const e = await createEvent(title)
    if (e) await setEventInChapter(e.id, chapter.id, true)
  }
  // Removing a present place also clears it from any character located there
  // this chapter (a place can be "present" purely via a character location).
  async function removePlace(placeId) {
    for (const c of presentCharacters) {
      if (charPlaceId(c.id) === placeId) await setCharacterPlace(chapter.id, c.id, null)
      if (charEndPlaceId(c.id) === placeId) await setCharacterEndPlace(chapter.id, c.id, null)
    }
    await setPlacePresent(chapter.id, placeId, false)
  }

  return (
    <div className="meta-panel">
      <h3>Kapitel-Metadaten</h3>

      <div className="meta-wordcount">
        <span>Wörter</span>
        <b>{countWords(chapter.body).toLocaleString('de-DE')}</b>
      </div>

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
        <span>Zusammenfassung</span>
        <textarea
          ref={summaryRef}
          className="summary-textarea"
          rows={2}
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
                    <X size={15} />
                  </button>
                </div>
                <div className="loc-range">
                  <label className="loc-part">
                    <span className="loc-label">von</span>
                    <select
                      className="loc-select"
                      value={charPlaceId(c.id)}
                      onChange={(e) => setCharacterPlace(chapter.id, c.id, e.target.value || null)}
                      title="Startort in diesem Kapitel"
                    >
                      <option value="">— Ort wählen —</option>
                      {placeOptionsFor(c.id).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="loc-part">
                    <span className="loc-label">bis</span>
                    <select
                      className="loc-select loc-end"
                      value={charEndPlaceId(c.id)}
                      onChange={(e) => setCharacterEndPlace(chapter.id, c.id, e.target.value || null)}
                      title="Optionaler Zielort — leer lassen, wenn die Figur sich nicht bewegt"
                    >
                      <option value="">— kein Ortswechsel —</option>
                      {placeOptionsFor(c.id).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
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
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Events in this chapter -------------------------------------------- */}
      <div className="field">
        <div className="field-head">
          <span>Ereignisse in diesem Kapitel</span>
        </div>
        <AddCombo
          placeholder="Ereignis suchen oder anlegen …"
          options={unselectedEvents.map((e) => ({ id: e.id, name: e.title }))}
          onPick={pickEvent}
          onCreate={createEventPresent}
        />
        {chapterEvents.length === 0 ? (
          <p className="hint">Keine Ereignisse in diesem Kapitel.</p>
        ) : (
          <ul className="chip-list">
            {chapterEvents.map((e) => (
              <li key={e.id} className="chip">
                <button className="chip-link" onClick={() => openCard('event', e.id)}>
                  {e.title}
                </button>
                <button
                  className="chip-remove"
                  title="Verknüpfung entfernen"
                  onClick={() => setEventInChapter(e.id, chapter.id, false)}
                >
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
