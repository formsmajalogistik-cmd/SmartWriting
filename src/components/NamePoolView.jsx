import { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Dices,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { NAME_POOL_CATEGORIES, NAME_POOL_GENDERS, NAME_POOL_TAGS } from '../data/types.js'
import {
  decorate,
  filterPool,
  parseNamePoolJson,
  pickRandom,
  regionOptions,
  categoryOptions,
  tagOptions,
} from '../lib/namePool.js'
import ListField from './ListField.jsx'

// NAMENSPOOL — a reservoir of names for minor and background characters,
// scoped to the active project.
//
// Two things are deliberately NOT stored:
//   • "used": a name counts as used when a character card carries it as its
//     name or alias (case-insensitive) — derived live, so deleting the
//     character returns the name to the pool;
//   • the collision warning: it is computed from the project's editable prefix
//     list, so it stays accurate as the main cast grows. It warns, never blocks.
export default function NamePoolView() {
  const {
    namePool,
    regions,
    characters,
    namePoolPrefixes,
    setNamePoolPrefixes,
    createNamePoolEntry,
    updateNamePoolEntry,
    deleteNamePoolEntry,
    importNamePool,
    createCharacterFromPoolName,
    openCard,
  } = useStore()

  const [query, setQuery] = useState('')
  const [region, setRegion] = useState('')
  const [gender, setGender] = useState('')
  const [category, setCategory] = useState('')
  const [tag, setTag] = useState('')
  const [showUsed, setShowUsed] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [picked, setPicked] = useState(null) // the "Zufällig" suggestion
  const [editing, setEditing] = useState(null) // entry id being edited
  const [adding, setAdding] = useState(false)
  const [importMsg, setImportMsg] = useState(null) // { kind: 'ok'|'err', text }
  const [importing, setImporting] = useState(false)
  const fileRef = useRef(null)

  const decorated = useMemo(
    () => decorate(namePool, { characters, regions, prefixes: namePoolPrefixes }),
    [namePool, characters, regions, namePoolPrefixes],
  )
  const filters = { query, region, gender, category, tag, showUsed, showHidden }
  const shown = useMemo(() => filterPool(decorated, filters), [decorated, query, region, gender, category, tag, showUsed, showHidden])
  const regionOpts = useMemo(() => regionOptions(namePool, regions), [namePool, regions])
  const catOpts = useMemo(() => categoryOptions(namePool), [namePool])
  const tags = useMemo(() => tagOptions(namePool), [namePool])
  const usedCount = decorated.filter((d) => d.used).length
  const freeCount = decorated.filter((d) => !d.used && !d.entry.hidden).length

  // --- import ---------------------------------------------------------------
  async function runImport(parsed) {
    if (parsed.error) {
      setImportMsg({ kind: 'err', text: parsed.error })
      return
    }
    setImporting(true)
    try {
      const res = await importNamePool(parsed)
      const un = res.matchedRegions?.unmatched || []
      setImportMsg({
        kind: 'ok',
        text:
          `${res.imported} Namen importiert, ${res.skipped} übersprungen (schon im Pool).` +
          (un.length ? ` Ohne passende Region-Karte, als Freitext gespeichert: ${un.join(', ')}.` : ''),
      })
    } catch (e) {
      setImportMsg({ kind: 'err', text: e?.message || 'Import fehlgeschlagen.' })
    } finally {
      setImporting(false)
    }
  }
  async function importSeed() {
    setImportMsg(null)
    try {
      // Lazily loaded: the registry is not part of the start-up bundle.
      const mod = await import('../../seed/ilema-namenspool.json')
      await runImport(parseNamePoolJson(mod.default || mod))
    } catch (e) {
      setImportMsg({ kind: 'err', text: e?.message || 'Datei konnte nicht geladen werden.' })
    }
  }
  async function importFile(file) {
    setImportMsg(null)
    if (!file) return
    try {
      await runImport(parseNamePoolJson(JSON.parse(await file.text())))
    } catch {
      setImportMsg({ kind: 'err', text: 'Die Datei ist kein gültiges JSON.' })
    }
  }

  async function makeCharacter(entry) {
    const created = await createCharacterFromPoolName(entry)
    if (created) openCard('character', created.id)
  }

  function randomPick() {
    setPicked(pickRandom(filterPool(decorated, { ...filters, showUsed: false, showHidden: false })))
  }

  return (
    <div className="pool">
      <p className="hint">
        Namen für Rand- und Hintergrundfiguren — nur für dieses Projekt. Verwendete Namen erkennt
        die App selbst an den Figurenkarten (Name oder Alias); löschst du die Figur, ist der Name
        wieder frei.
      </p>

      {/* ---- filters ---- */}
      <div className="pool-bar">
        <input
          className="pool-search"
          type="search"
          value={query}
          placeholder="Suchen … (Name, Region, Kategorie, Tag, Notiz)"
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
          <option value="">Alle Regionen</option>
          {regionOpts.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <select value={gender} onChange={(e) => setGender(e.target.value)} aria-label="Geschlecht">
          <option value="">Jedes Geschlecht</option>
          {NAME_POOL_GENDERS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategorie">
          <option value="">Alle Kategorien</option>
          {catOpts.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Rollen-Tag">
          <option value="">Alle Rollen-Tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button className="toggle primary pool-random" onClick={randomPick} disabled={!freeCount}>
          <Dices size={15} /> Zufällig
        </button>
      </div>
      <div className="pool-bar pool-bar-2">
        <label className="checkbox">
          <input type="checkbox" checked={showUsed} onChange={(e) => setShowUsed(e.target.checked)} />
          <span>auch verwendete anzeigen</span>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          <span>auch ausgeblendete anzeigen</span>
        </label>
        <span className="pool-counts">
          {shown.length} angezeigt · {freeCount} frei · {usedCount} verwendet · {namePool.length} im
          Pool
        </span>
      </div>

      {/* ---- random suggestion ---- */}
      {picked && (
        <div className="pool-pick">
          <span className="pool-pick-label">Vorschlag</span>
          <b className="pool-pick-name">{picked.entry.name}</b>
          <EntryMeta d={picked} />
          <button className="toggle" onClick={() => makeCharacter(picked.entry)}>
            <UserPlus size={14} /> Als Figur anlegen
          </button>
          <button className="toggle" onClick={randomPick}>
            <Dices size={14} /> Nochmal
          </button>
          <button className="icon-btn" title="Schließen" aria-label="Schließen" onClick={() => setPicked(null)}>
            <X size={15} />
          </button>
        </div>
      )}

      {/* ---- list ---- */}
      {shown.length === 0 ? (
        <p className="hint pool-empty">
          {namePool.length === 0
            ? 'Der Pool ist leer — importiere die Namen unten oder lege einzelne Namen an.'
            : 'Keine Namen passen zu diesen Filtern.'}
        </p>
      ) : (
        <ul className="pool-list">
          {shown.map((d) =>
            editing === d.entry.id ? (
              <li key={d.entry.id} className="pool-row editing">
                <PoolForm
                  entry={d.entry}
                  regions={regions}
                  onCancel={() => setEditing(null)}
                  onSave={async (patch) => {
                    await updateNamePoolEntry(d.entry.id, patch)
                    setEditing(null)
                  }}
                />
              </li>
            ) : (
              <li key={d.entry.id} className={`pool-row ${d.used ? 'used' : ''} ${d.entry.hidden ? 'hidden-row' : ''}`}>
                <span className="pool-name">{d.entry.name}</span>
                {d.warning && (
                  <span className="pool-warn" title={`Ähnlich wie ein Hauptfiguren-Anfang: ${d.warning}-`}>
                    <AlertTriangle size={13} /> {d.warning}-
                  </span>
                )}
                <EntryMeta d={d} />
                {d.used && (
                  <button
                    className="names-chip pool-used-chip"
                    title="Figur öffnen"
                    onClick={() => openCard('character', d.used.character.id)}
                  >
                    <Check size={12} /> {d.used.character.name}
                    {d.used.alias ? ` (Alias „${d.used.alias}“)` : ''}
                  </button>
                )}
                {d.entry.hidden && <span className="badge small">ausgeblendet</span>}
                {d.entry.notes && <span className="pool-notes">{d.entry.notes}</span>}
                <span className="pool-actions">
                  {!d.used && (
                    <button className="toggle" onClick={() => makeCharacter(d.entry)}>
                      <UserPlus size={14} /> Als Figur anlegen
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    title="Bearbeiten"
                    aria-label="Bearbeiten"
                    onClick={() => setEditing(d.entry.id)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-btn"
                    title={d.entry.hidden ? 'Wieder vorschlagen' : 'Nie vorschlagen'}
                    aria-label={d.entry.hidden ? 'Wieder vorschlagen' : 'Nie vorschlagen'}
                    onClick={() => updateNamePoolEntry(d.entry.id, { hidden: !d.entry.hidden })}
                  >
                    {d.entry.hidden ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                  <button
                    className="icon-btn danger"
                    title="Löschen"
                    aria-label="Löschen"
                    onClick={() => {
                      if (window.confirm(`„${d.entry.name}“ aus dem Pool löschen?`)) {
                        deleteNamePoolEntry(d.entry.id)
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}

      {/* ---- add ---- */}
      <section className="names-section pool-add">
        {adding ? (
          <PoolForm
            regions={regions}
            onCancel={() => setAdding(false)}
            onSave={async (patch) => {
              await createNamePoolEntry(patch)
              setAdding(false)
            }}
          />
        ) : (
          <button className="toggle primary" onClick={() => setAdding(true)}>
            <Plus size={15} /> Namen hinzufügen
          </button>
        )}
      </section>

      {/* ---- import ---- */}
      <section className="names-section">
        <h3>Namen importieren (JSON)</h3>
        <p className="hint">
          Importiert in <b>dieses</b> Projekt. Regionen werden über den Namen mit den Region-Karten
          verknüpft; ohne passende Karte bleibt die Region als Freitext stehen. Mehrfaches
          Importieren legt nichts doppelt an.
        </p>
        <div className="pool-import">
          <button className="toggle primary" onClick={importSeed} disabled={importing}>
            <Upload size={15} /> Ilema-Namenspool importieren
          </button>
          <button className="toggle" onClick={() => fileRef.current?.click()} disabled={importing}>
            <Upload size={15} /> Eigene JSON-Datei …
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="pool-file"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              importFile(f)
            }}
          />
        </div>
        {importMsg && (
          <p className={`hint ${importMsg.kind === 'err' ? 'pool-msg-err' : 'pool-msg-ok'}`}>
            {importMsg.text}
          </p>
        )}
      </section>

      {/* ---- collision prefixes ---- */}
      <section className="names-section">
        <h3>Geschützte Namensanfänge</h3>
        <ListField
          label="Anfänge der Hauptfiguren"
          hint="Pool-Namen, die so beginnen, werden gewarnt (nie blockiert) — damit keine Randfigur wie eine Hauptfigur klingt. Die Liste gilt für dieses Projekt und wird beim Import vorbelegt."
          placeholder="z. B. Amr"
          value={namePoolPrefixes}
          onChange={(list) => setNamePoolPrefixes(list)}
        />
      </section>
    </div>
  )
}

// Region / Geschlecht / Kategorie / Tags of one entry, as compact chips.
function EntryMeta({ d }) {
  const e = d.entry
  return (
    <span className="pool-meta">
      {d.region && <span className="badge small">{d.region}</span>}
      <span className="badge small">{e.gender}</span>
      <span className="badge small">{e.category}</span>
      {(e.tags || []).map((t) => (
        <span key={t} className="badge small pool-tag">
          {t}
        </span>
      ))}
    </span>
  )
}

// Add / edit form for one pool entry. Region is a card selector with a
// free-text fallback (not every region in a registry has a card).
function PoolForm({ entry, regions, onSave, onCancel }) {
  const [name, setName] = useState(entry?.name || '')
  const [regionId, setRegionId] = useState(entry?.region_id || '')
  const [regionText, setRegionText] = useState(entry?.region_text || '')
  const [gender, setGender] = useState(entry?.gender || 'neutral')
  const [category, setCategory] = useState(entry?.category || NAME_POOL_CATEGORIES[0])
  const [tags, setTags] = useState(entry?.tags || [])
  const [notes, setNotes] = useState(entry?.notes || '')

  function submit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      region_id: regionId || null,
      region_text: regionId ? '' : regionText.trim(),
      gender,
      category: category.trim() || 'Vorname',
      tags,
      notes,
    })
  }

  return (
    <form className="pool-form" onSubmit={submit}>
      <div className="pool-form-row">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Region (Karte)</span>
          <select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
            <option value="">— Freitext —</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {!regionId && (
          <label className="field">
            <span>Region (Freitext)</span>
            <input
              value={regionText}
              onChange={(e) => setRegionText(e.target.value)}
              placeholder="z. B. Porsiran (Hauptstadt)"
            />
          </label>
        )}
        <label className="field">
          <span>Geschlecht</span>
          <select value={gender} onChange={(e) => setGender(e.target.value)}>
            {NAME_POOL_GENDERS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Kategorie</span>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            list="pool-categories"
            placeholder="z. B. Vorname"
          />
          <datalist id="pool-categories">
            {NAME_POOL_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="pool-form-row">
        <ListField
          label="Rollen-Tags"
          placeholder={`z. B. ${NAME_POOL_TAGS[0]}`}
          value={tags}
          onChange={setTags}
        />
        <label className="field pool-notes-field">
          <span>Notizen</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <div className="pool-form-actions">
        <button type="submit" className="toggle primary" disabled={!name.trim()}>
          <Check size={15} /> Speichern
        </button>
        <button type="button" className="toggle" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  )
}
