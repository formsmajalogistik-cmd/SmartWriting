import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store.jsx'
import PortraitField from './PortraitField.jsx'
import ListField from './ListField.jsx'

// Generic worldbuilding cards view: a list of cards on the left, a detail
// editor on the right. Driven by a config (see cardConfig.js) so Characters
// and Places share one implementation. Edits autosave (debounced).
//
// Props:
//   config   — CHARACTER_CONFIG | PLACE_CONFIG
//   items    — the project's cards (characters or places)
//   onCreate(name) -> Promise<card>
//   onUpdate(id, patch) -> Promise<card>
//   onDelete(id) -> Promise<void>
export default function CardsView({ config, items, onCreate, onUpdate, onDelete, focusId, onFocusConsumed }) {
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [onlyProvisional, setOnlyProvisional] = useState(false)

  // Open a specific card when navigated here (e.g. clicking a #link).
  useEffect(() => {
    if (focusId) {
      setSelectedId(focusId)
      onFocusConsumed?.()
    }
  }, [focusId, onFocusConsumed])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((it) => {
      if (onlyProvisional && it.name_final) return false
      if (q && !it.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [items, search, onlyProvisional])

  const selected = items.find((it) => it.id === selectedId) || null

  async function handleCreate() {
    const card = await onCreate(config.newName)
    if (card) setSelectedId(card.id)
  }

  return (
    <div className="cards-view">
      <div className="cards-list">
        <div className="cards-list-head">
          <input
            className="cards-search"
            type="search"
            placeholder={`${config.plural} suchen …`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="toggle primary" onClick={handleCreate}>
            ＋ Neu
          </button>
        </div>
        <label className="cards-filter">
          <input
            type="checkbox"
            checked={onlyProvisional}
            onChange={(e) => setOnlyProvisional(e.target.checked)}
          />
          <span>Nur provisorische Namen</span>
        </label>

        {visible.length === 0 ? (
          <p className="hint cards-empty">
            {items.length === 0
              ? `Noch keine ${config.plural}. Lege die erste Karte an.`
              : 'Keine Treffer.'}
          </p>
        ) : (
          <ul className="card-items">
            {visible.map((it) => (
              <li
                key={it.id}
                className={`card-item ${it.id === selectedId ? 'active' : ''}`}
                onClick={() => setSelectedId(it.id)}
              >
                <div className="card-item-main">
                  <span className="card-item-name">{it.name || '(ohne Namen)'}</span>
                  {!it.name_final && <span className="badge provisional">provisorisch</span>}
                </div>
                <span className="card-item-sub">
                  {config.subtitleKeys
                    .map((k) => it[k])
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card-detail">
        {selected ? (
          <CardEditor
            key={selected.id}
            config={config}
            card={selected}
            onUpdate={onUpdate}
            onDelete={async () => {
              if (window.confirm(`„${selected.name}“ löschen?`)) {
                await onDelete(selected.id)
                setSelectedId(null)
              }
            }}
          />
        ) : (
          <div className="empty-state card-detail-empty">
            <h2>Keine Karte ausgewählt</h2>
            <p>Wähle links eine {config.singular} oder lege eine neue an.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function buildDraft(config, card) {
  const top = { name: card.name ?? '', name_final: !!card.name_final }
  for (const f of config.topFields) top[f.key] = card[f.key] ?? ''
  const cardObj = {}
  for (const f of config.cardFields) cardObj[f.key] = card.card?.[f.key] ?? ''
  for (const f of config.detailFields ?? []) cardObj[f.key] = card.card?.[f.key] ?? ''
  for (const f of config.physicalNotes ?? []) cardObj[f.key] = card.card?.[f.key] ?? ''
  for (const f of config.listFields ?? []) {
    cardObj[f.key] = Array.isArray(card.card?.[f.key]) ? card.card[f.key] : []
  }
  if (config.portrait) cardObj.portrait_path = card.card?.portrait_path ?? ''
  return { ...top, card: cardObj }
}

function CardEditor({ config, card, onUpdate, onDelete }) {
  const { findReferences, renameReferences } = useStore()
  const [draft, setDraft] = useState(() => buildDraft(config, card))
  const saveTimer = useRef(null)
  // The name as it was when this card was opened — to detect renames on blur.
  const originalNameRef = useRef(card.name)

  // Re-seed when switching to a different card (component is keyed by id, so
  // this mainly guards against in-place identity changes).
  useEffect(() => {
    setDraft(buildDraft(config, card))
    originalNameRef.current = card.name
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id])

  // On rename, offer to update existing "#OldName" references — never silently.
  async function onNameBlur() {
    const oldName = (originalNameRef.current || '').trim()
    const newName = (draft.name || '').trim()
    if (!oldName || !newName || oldName === newName) {
      originalNameRef.current = draft.name
      return
    }
    const refs = findReferences(oldName)
    const total = refs.reduce((n, r) => n + r.count, 0)
    originalNameRef.current = draft.name // don't re-prompt for this rename
    if (total === 0) return
    const ok = window.confirm(
      `„#${oldName}“ kommt ${total}× in ${refs.length} Kapitel(n) vor. ` +
        `Diese Referenzen auf „#${newName}“ aktualisieren?`,
    )
    if (ok) await renameReferences(oldName, newName)
  }

  function buildPatch(next) {
    const patch = { name: next.name, name_final: next.name_final, card: next.card }
    for (const f of config.topFields) patch[f.key] = next[f.key]
    return patch
  }
  function save(next) {
    onUpdate(card.id, buildPatch(next)).catch(() => {
      /* surfaced by the global error banner */
    })
  }
  function persist(next) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(next), 500)
  }
  // Immediate save for discrete actions (e.g. portrait change) so the path is
  // never lost to a pending debounce.
  function persistNow(next) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    save(next)
  }
  useEffect(() => () => saveTimer.current && clearTimeout(saveTimer.current), [])

  function setTop(key, value) {
    setDraft((d) => {
      const next = { ...d, [key]: value }
      persist(next)
      return next
    })
  }
  function setCardField(key, value) {
    setDraft((d) => {
      const next = { ...d, card: { ...d.card, [key]: value } }
      persist(next)
      return next
    })
  }
  function setPortrait(p) {
    setDraft((d) => {
      const next = { ...d, card: { ...d.card, portrait_path: p || '' } }
      persistNow(next)
      return next
    })
  }

  const hasPhysical =
    (config.detailFields?.length || 0) +
      (config.listFields?.length || 0) +
      (config.physicalNotes?.length || 0) >
    0

  return (
    <div className="card-editor">
      <div className="card-editor-head">
        <input
          className="card-name-input"
          value={draft.name}
          placeholder={`Name der ${config.singular}`}
          onChange={(e) => setTop('name', e.target.value)}
          onBlur={onNameBlur}
        />
        <label className="checkbox name-final">
          <input
            type="checkbox"
            checked={draft.name_final}
            onChange={(e) => setTop('name_final', e.target.checked)}
          />
          <span>Name final</span>
        </label>
        <button className="icon-btn danger" title="Löschen" onClick={onDelete}>
          🗑
        </button>
      </div>
      {!draft.name_final && (
        <div className="provisional-note">
          <span className="badge provisional">provisorisch</span> Name noch nicht festgelegt.
        </div>
      )}

      {config.portrait && (
        <PortraitField
          characterId={card.id}
          path={draft.card.portrait_path}
          onChange={setPortrait}
        />
      )}

      <div className="card-top-grid">
        {config.topFields.map((f) => (
          <label className="field" key={f.key}>
            <span>{f.label}</span>
            {f.type === 'select' ? (
              <select value={draft[f.key] || ''} onChange={(e) => setTop(f.key, e.target.value)}>
                <option value="">{f.placeholder || '—'}</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={draft[f.key] || ''}
                onChange={(e) => setTop(f.key, e.target.value)}
              />
            )}
          </label>
        ))}
      </div>

      {hasPhysical && (
        <div className="card-physical">
          {config.detailFields?.length > 0 && (
            <div className="detail-grid">
              {config.detailFields.map((f) => (
                <label className="field" key={f.key}>
                  <span>{f.label}</span>
                  <input
                    type="text"
                    value={draft.card[f.key] || ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setCardField(f.key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          )}
          {config.listFields?.map((f) => (
            <ListField
              key={f.key}
              label={f.label}
              placeholder={f.placeholder}
              hint={f.hint}
              value={draft.card[f.key]}
              onChange={(arr) => setCardField(f.key, arr)}
            />
          ))}
          {config.physicalNotes?.map((f) => (
            <label className="field" key={f.key}>
              <span>{f.label}</span>
              <textarea
                rows={2}
                value={draft.card[f.key] || ''}
                placeholder={f.placeholder}
                onChange={(e) => setCardField(f.key, e.target.value)}
              />
            </label>
          ))}
        </div>
      )}

      <div className="card-rich">
        {config.cardFields.map((f) => (
          <label className="field" key={f.key}>
            <span>{f.label}</span>
            <textarea
              rows={3}
              value={draft.card[f.key] || ''}
              onChange={(e) => setCardField(f.key, e.target.value)}
            />
          </label>
        ))}
      </div>
    </div>
  )
}
