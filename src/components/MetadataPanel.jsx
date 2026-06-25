import { useStore } from '../state/store.jsx'
import { CHAPTER_STATUSES } from '../data/types.js'

// Per-chapter metadata: status, POV, one-line summary, characters present,
// places present, and — for each present character — where they are in this
// chapter. The location pickers write character_locations rows now so the map
// timeline (Phase 3) can read them later.
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

  const chapterLocs = locations.filter((l) => l.chapter_id === chapter.id)
  const presentCharIds = new Set(chapterLocs.filter((l) => l.character_id).map((l) => l.character_id))
  const presentPlaceIds = new Set(chapterLocs.filter((l) => l.place_id).map((l) => l.place_id))
  const charPlace = (charId) =>
    chapterLocs.find((l) => l.character_id === charId)?.place_id || ''

  async function addCharacter() {
    const name = window.prompt('Name der Figur:')
    if (!name || !name.trim()) return
    const c = await createCharacter(name.trim())
    await setCharacterPresent(chapter.id, c.id, true)
  }

  async function addPlace() {
    const name = window.prompt('Name des Orts:')
    if (!name || !name.trim()) return
    const p = await createPlace(name.trim())
    await setPlacePresent(chapter.id, p.id, true)
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

      <div className="field">
        <div className="field-head">
          <span>Anwesende Figuren</span>
          <button className="link-btn" onClick={addCharacter}>
            ＋ neu
          </button>
        </div>
        {characters.length === 0 && <p className="hint">Noch keine Figuren angelegt.</p>}
        <ul className="present-list">
          {characters.map((c) => {
            const present = presentCharIds.has(c.id)
            return (
              <li key={c.id} className="present-item">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={present}
                    onChange={(e) => setCharacterPresent(chapter.id, c.id, e.target.checked)}
                  />
                  <span>{c.name}</span>
                </label>
                {present && (
                  <select
                    className="loc-select"
                    value={charPlace(c.id)}
                    onChange={(e) => setCharacterPlace(chapter.id, c.id, e.target.value || null)}
                    title="Wo ist die Figur in diesem Kapitel?"
                  >
                    <option value="">— Ort wählen —</option>
                    {places.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <div className="field">
        <div className="field-head">
          <span>Anwesende Orte</span>
          <button className="link-btn" onClick={addPlace}>
            ＋ neu
          </button>
        </div>
        {places.length === 0 && <p className="hint">Noch keine Orte angelegt.</p>}
        <ul className="present-list">
          {places.map((p) => (
            <li key={p.id} className="present-item">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={presentPlaceIds.has(p.id)}
                  onChange={(e) => setPlacePresent(chapter.id, p.id, e.target.checked)}
                />
                <span>{p.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
