import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeftRight, Check, Network, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import {
  REL_TYPES,
  derivedForWithUncertainty,
  findDuplicate,
  findReverseConflict,
  forwardLabel,
  backwardLabel,
  isSymmetric,
  parentIds,
  childIds,
  spouseIds,
  siblingIds,
  relationsOf,
  wouldCycle,
} from '../lib/relationships.js'

// The relationship block on a character card: the immediate family as a small
// tree, every other connection grouped by type, the DERIVED relatives (dashed /
// badged, never entered by hand), and an editor for adding or changing a
// relationship — always ONE row per fact, the counterpart follows automatically.
export default function CharacterRelations({ characterId }) {
  const {
    characters,
    relationships,
    createRelationship,
    updateRelationship,
    deleteRelationship,
    activeProject,
    openCard,
    setView,
  } = useStore()
  const books = activeProject?.settings?.books ?? []
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [msg, setMsg] = useState(null)

  const me = characters.find((c) => c.id === characterId)
  const nameOf = (id) => characters.find((c) => c.id === id)?.name || '—'
  const cardOf = (id) => characters.find((c) => c.id === id) || null

  const entered = useMemo(() => relationsOf(characterId, relationships), [characterId, relationships])
  const derived = useMemo(
    () => derivedForWithUncertainty(characterId, relationships),
    [characterId, relationships],
  )
  const family = useMemo(
    () => ({
      parents: parentIds(characterId, relationships),
      children: childIds(characterId, relationships),
      spouses: spouseIds(characterId, relationships),
      siblings: siblingIds(characterId, relationships),
    }),
    [characterId, relationships],
  )

  // Everything that is not part of the little family tree, grouped by label.
  const otherGroups = useMemo(() => {
    const groups = new Map()
    for (const e of entered) {
      if (e.rel.type === 'elternteil' || e.rel.type === 'ehepartner' || e.rel.type === 'partner') continue
      if (e.rel.type === 'geschwister') continue
      const list = groups.get(e.label) || []
      list.push(e)
      groups.set(e.label, list)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de'))
  }, [entered])

  const derivedGroups = useMemo(() => {
    const groups = new Map()
    for (const d of derived) {
      const list = groups.get(d.label) || []
      list.push(d)
      groups.set(d.label, list)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de'))
  }, [derived])

  const bookTitle = (id) => books.find((b) => b.id === id)?.title || ''
  const bookRange = (rel) => {
    const from = bookTitle(rel.started_book)
    const to = bookTitle(rel.ended_book)
    if (from && to) return `${from} – ${to}`
    if (from) return `ab ${from}`
    if (to) return `bis ${to}`
    return ''
  }

  async function save(values, id) {
    setMsg(null)
    try {
      if (id) await updateRelationship(id, values)
      else await createRelationship(values)
      setAdding(false)
      setEditing(null)
    } catch (e) {
      setMsg(e?.message || 'Konnte nicht gespeichert werden.')
    }
  }

  function FamilyChip({ id, extra }) {
    const card = cardOf(id)
    return (
      <button
        className={`rel-chip ${card && !card.name_final ? 'provisional' : ''}`}
        title="Karte öffnen"
        onClick={() => openCard('character', id)}
      >
        {nameOf(id)}
        {extra}
      </button>
    )
  }

  if (!me) return null

  return (
    <section className="rel-block">
      <div className="rel-block-head">
        <h3>Beziehungen</h3>
        <span className="rel-block-count">
          {entered.length} eingetragen · {derived.length} abgeleitet
        </span>
        <button className="toggle rel-overview-btn" onClick={() => setView('relations')} title="Gesamtübersicht öffnen">
          <Network size={14} /> Übersicht
        </button>
        {!adding && (
          <button className="toggle primary" onClick={() => { setAdding(true); setEditing(null) }}>
            <Plus size={14} /> Beziehung
          </button>
        )}
      </div>

      {msg && (
        <p className="hint rel-msg">
          <AlertTriangle size={14} /> {msg}
        </p>
      )}

      {adding && (
        <RelationForm
          me={me}
          characters={characters}
          relationships={relationships}
          books={books}
          onCancel={() => setAdding(false)}
          onSave={(v) => save(v)}
        />
      )}

      {/* ---- immediate family as a small tree ---- */}
      <div className="rel-tree">
        <div className="rel-tree-row">
          <span className="rel-tree-label">Eltern</span>
          <span className="rel-tree-items">
            {family.parents.length ? family.parents.map((id) => <FamilyChip key={id} id={id} />) : <i className="rel-none">—</i>}
          </span>
        </div>
        <div className="rel-tree-row rel-tree-self">
          <span className="rel-tree-label">Diese Figur</span>
          <span className="rel-tree-items">
            <span className="rel-chip self">{me.name}</span>
            {family.spouses.map((id) => (
              <FamilyChip key={id} id={id} extra={<em className="rel-chip-role">Partner</em>} />
            ))}
            {family.siblings.map((id) => (
              <FamilyChip key={id} id={id} extra={<em className="rel-chip-role">Geschwister</em>} />
            ))}
          </span>
        </div>
        <div className="rel-tree-row">
          <span className="rel-tree-label">Kinder</span>
          <span className="rel-tree-items">
            {family.children.length ? family.children.map((id) => <FamilyChip key={id} id={id} />) : <i className="rel-none">—</i>}
          </span>
        </div>
      </div>

      {/* ---- every entered relationship, grouped ---- */}
      <ul className="rel-list">
        {entered.map((e) =>
          editing === e.rel.id ? (
            <li key={e.rel.id} className="rel-row editing">
              <RelationForm
                me={me}
                characters={characters}
                relationships={relationships}
                books={books}
                existing={e.rel}
                onCancel={() => setEditing(null)}
                onSave={(v) => save(v, e.rel.id)}
              />
            </li>
          ) : (
            <li key={e.rel.id} className="rel-row">
              <span className="rel-type">{e.label}</span>
              <button
                className={`rel-chip ${cardOf(e.otherId) && !cardOf(e.otherId).name_final ? 'provisional' : ''}`}
                title="Karte öffnen"
                onClick={() => openCard('character', e.otherId)}
              >
                {nameOf(e.otherId)}
              </button>
              {e.rel.uncertain && <span className="badge small rel-uncertain">unsicher / geheim</span>}
              {bookRange(e.rel) && <span className="badge small">{bookRange(e.rel)}</span>}
              {e.rel.note && <span className="rel-note">{e.rel.note}</span>}
              <span className="rel-actions">
                <button
                  className="icon-btn"
                  title="Bearbeiten"
                  aria-label="Bearbeiten"
                  onClick={() => { setEditing(e.rel.id); setAdding(false) }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="icon-btn danger"
                  title="Beziehung entfernen"
                  aria-label="Beziehung entfernen"
                  onClick={() => {
                    if (window.confirm(`Beziehung „${e.label} — ${nameOf(e.otherId)}“ entfernen?`)) {
                      deleteRelationship(e.rel.id)
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

      {otherGroups.length > 0 && (
        <div className="rel-groups">
          {otherGroups.map(([label, list]) => (
            <span key={label} className="rel-group">
              <b>{label}:</b> {list.map((e) => nameOf(e.otherId)).join(', ')}
            </span>
          ))}
        </div>
      )}

      {/* ---- derived relatives ---- */}
      {derivedGroups.length > 0 && (
        <div className="rel-derived">
          <span className="rel-derived-head">
            Abgeleitet aus der Abstammung <span className="badge small rel-derived-badge">abgeleitet</span>
          </span>
          <ul className="rel-list derived">
            {derivedGroups.map(([label, list]) => (
              <li key={label} className="rel-row derived">
                <span className="rel-type">{label}</span>
                {list.map((d) => (
                  <button
                    key={d.kind + d.otherId}
                    className={`rel-chip derived ${cardOf(d.otherId) && !cardOf(d.otherId).name_final ? 'provisional' : ''} ${d.uncertain ? 'uncertain' : ''}`}
                    title={`${d.via}${d.uncertain ? ' · folgt aus einer unsicheren Beziehung' : ''} — Karte öffnen`}
                    onClick={() => openCard('character', d.otherId)}
                  >
                    {nameOf(d.otherId)}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// Add / edit one relationship. The DIRECTION of a directional type is chosen in
// plain German ("Zalvia ist Elternteil von Brend" vs. the other way round), so
// the single stored row is never ambiguous.
function RelationForm({ me, characters, relationships, books, existing, onCancel, onSave }) {
  const otherInitial = existing
    ? existing.from_character_id === me.id
      ? existing.to_character_id
      : existing.from_character_id
    : ''
  const [type, setType] = useState(existing?.type || 'freund')
  const [otherId, setOtherId] = useState(otherInitial)
  const [meFirst, setMeFirst] = useState(existing ? existing.from_character_id === me.id : true)
  const [note, setNote] = useState(existing?.note || '')
  const [started, setStarted] = useState(existing?.started_book || '')
  const [ended, setEnded] = useState(existing?.ended_book || '')
  const [uncertain, setUncertain] = useState(!!existing?.uncertain)
  const [query, setQuery] = useState('')
  const [warning, setWarning] = useState(null)

  const t = REL_TYPES.find((x) => x.key === type) || REL_TYPES[0]
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return characters
      .filter((c) => c.id !== me.id)
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 12)
    // All characters are selectable regardless of the cards view's subtab.
  }, [characters, me.id, query])
  const otherName = characters.find((c) => c.id === otherId)?.name || ''

  const from = meFirst ? me.id : otherId
  const to = meFirst ? otherId : me.id

  function submit(e) {
    e.preventDefault()
    setWarning(null)
    if (!otherId) return setWarning('Bitte die zweite Figur wählen.')
    const values = { from_character_id: from, to_character_id: to, type, note, started_book: started || null, ended_book: ended || null, uncertain }
    const dup = findDuplicate(relationships, values, existing?.id)
    if (dup) return setWarning('Diese Beziehung ist schon eingetragen.')
    const rev = findReverseConflict(relationships, values, existing?.id)
    if (rev) {
      const ok = window.confirm(
        `„${forwardLabel(type)}“ ist schon in der anderen Richtung eingetragen ` +
          `(${characters.find((c) => c.id === rev.from_character_id)?.name} → ` +
          `${characters.find((c) => c.id === rev.to_character_id)?.name}). Widerspricht sich. Trotzdem speichern?`,
      )
      if (!ok) return
    }
    if (type === 'elternteil' && wouldCycle(relationships.filter((r) => r.id !== existing?.id), from, to)) {
      const ok = window.confirm(
        'Das erzeugt einen Kreis in der Abstammung (jemand wäre sein eigener Vorfahre). Trotzdem speichern?',
      )
      if (!ok) return
      values.allowCycle = true
    }
    onSave(values)
  }

  return (
    <form className="rel-form" onSubmit={submit}>
      <div className="rel-form-row">
        <label className="field">
          <span>Art</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {REL_TYPES.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
                {x.symmetric ? '' : ` → ${x.inverse}`}
              </option>
            ))}
          </select>
        </label>
        {/* NOT a <label>: a label forwards its activation to the first
            labelable descendant, so picking a candidate would immediately be
            undone by the "Andere wählen" button that replaces the search box. */}
        <div className="field rel-pick">
          <span>Zweite Figur</span>
          {otherId ? (
            <span className="rel-picked">
              <b>{otherName}</b>
              <button type="button" className="icon-btn" title="Andere wählen" aria-label="Andere wählen" onClick={() => setOtherId('')}>
                <X size={14} />
              </button>
            </span>
          ) : (
            <>
              <input
                type="search"
                value={query}
                placeholder="Figur suchen …"
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              <span className="rel-candidates">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-id={c.id}
                    className={`names-chip ${c.name_final ? '' : 'provisional'}`}
                    onClick={() => setOtherId(c.id)}
                  >
                    {c.name}
                  </button>
                ))}
                {candidates.length === 0 && <i className="rel-none">Keine Figur gefunden.</i>}
              </span>
            </>
          )}
        </div>
      </div>

      {!isSymmetric(type) && (
        <div className="rel-direction">
          <span className="rel-direction-text">
            {meFirst ? (
              <>
                <b>{me.name}</b> ist {t.label} von <b>{otherName || '…'}</b>
              </>
            ) : (
              <>
                <b>{otherName || '…'}</b> ist {t.label} von <b>{me.name}</b> — {me.name} ist also{' '}
                {backwardLabel(type)}
              </>
            )}
          </span>
          <button type="button" className="toggle" onClick={() => setMeFirst((v) => !v)}>
            <ArrowLeftRight size={14} /> Richtung tauschen
          </button>
        </div>
      )}

      <div className="rel-form-row">
        <label className="field rel-note-field">
          <span>Notiz</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
        </label>
        <label className="field">
          <span>Beginnt in</span>
          <select value={started} onChange={(e) => setStarted(e.target.value)}>
            <option value="">—</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Endet in</span>
          <select value={ended} onChange={(e) => setEnded(e.target.value)}>
            <option value="">—</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="checkbox rel-uncertain-toggle">
        <input type="checkbox" checked={uncertain} onChange={(e) => setUncertain(e.target.checked)} />
        <span>unsicher / geheim — steht in den Notizen, gilt aber nicht als gesicherte Tatsache</span>
      </label>

      {warning && (
        <p className="hint rel-msg">
          <AlertTriangle size={14} /> {warning}
        </p>
      )}

      <div className="rel-form-actions">
        <button type="submit" className="toggle primary" disabled={!otherId}>
          <Check size={15} /> Speichern
        </button>
        <button type="button" className="toggle" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  )
}
