import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Star } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { ROLE_LABELS } from '../data/types.js'
import { BOOK_STATUSES, deriveCharacterStatus } from '../lib/characterStatus.js'
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
// *_region_id subtitle keys resolve to the region's name; the legacy free-text
// column is the fallback while nothing is picked yet.
const REGION_LEGACY = { region_id: 'region', origin_region_id: 'origin' }

export default function CardsView({ config, items, onCreate, onUpdate, onDelete, focusId, onFocusConsumed }) {
  const { regions, activeProject, activeBookId } = useStore()
  const books = activeProject?.settings?.books ?? []
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [onlyProvisional, setOnlyProvisional] = useState(false)
  // Subtabs (characters: Hauptliste / Randfiguren / Pantheon) + filters. Both
  // organise THIS view only — every other consumer sees all items.
  const [subtab, setSubtab] = useState(config.subtabs?.[0]?.key || null)
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  // Book filter: default = the ACTIVE book (top-bar dropdown), or a specific
  // book, or all. Characters without appearance data are always shown.
  const [bookFilter, setBookFilter] = useState('__active__')
  const bookFilterId = bookFilter === '__active__' ? activeBookId : bookFilter || null

  const subtitleValue = (it, key) => {
    if (key in REGION_LEGACY) {
      return regions.find((r) => r.id === it[key])?.name || it[REGION_LEGACY[key]] || ''
    }
    if (key === 'role') return ROLE_LABELS[it.role] || it.role
    return it[key]
  }

  // Open a specific card when navigated here (e.g. clicking a #link).
  useEffect(() => {
    if (focusId) {
      setSelectedId(focusId)
      onFocusConsumed?.()
    }
  }, [focusId, onFocusConsumed])

  const activeTab = config.subtabs?.find((t) => t.key === subtab) || null
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((it) => {
      if (activeTab && !activeTab.match(it)) return false
      if (roleFilter && it.role !== roleFilter) return false
      if (statusFilter && deriveCharacterStatus(it, books, activeBookId) !== statusFilter) return false
      if (config.filters && bookFilterId) {
        const appears = it.card?.books
        if (Array.isArray(appears) && appears.length && !appears.includes(bookFilterId)) return false
      }
      if (onlyProvisional && it.name_final) return false
      if (q && !it.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [items, search, onlyProvisional, activeTab, roleFilter, statusFilter, books, activeBookId, bookFilterId, config.filters])

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
          <button className="toggle primary with-label" onClick={handleCreate}>
            <Plus size={15} /> Neu
          </button>
        </div>
        {config.subtabs && (
          <nav className="seg cards-subtabs" aria-label="Figuren-Gruppen">
            {config.subtabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`seg-btn ${subtab === t.key ? 'on' : ''}`}
                onClick={() => setSubtab(t.key)}
              >
                {t.label} ({items.filter((it) => t.match(it)).length})
              </button>
            ))}
          </nav>
        )}
        {config.filters && (
          <div className="cards-filter-row">
            <select value={bookFilter} onChange={(e) => setBookFilter(e.target.value)} aria-label="Nach Buch filtern">
              <option value="__active__">Aktives Buch</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>{b.title}</option>
              ))}
              <option value="">Alle Bücher</option>
            </select>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Nach Rolle filtern">
              <option value="">Alle Rollen</option>
              {(config.topFields.find((f) => f.key === 'role')?.options || []).map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Nach Status filtern">
              <option value="">Alle Status</option>
              {BOOK_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
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
                  {config.bookStatus && (() => {
                    const st = deriveCharacterStatus(it, books, activeBookId)
                    return st ? <span className={`char-status st-${st}`}>{st}</span> : null
                  })()}
                </div>
                <span className="card-item-sub">
                  {config.subtitleKeys
                    .map((k) => subtitleValue(it, k))
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
  for (const f of config.topFields) {
    top[f.key] = card[f.key] ?? ''
    if (f.legacyKey) top[f.legacyKey] = card[f.legacyKey] ?? ''
  }
  const cardObj = {}
  for (const f of config.cardFields) cardObj[f.key] = card.card?.[f.key] ?? ''
  for (const f of config.detailFields ?? []) cardObj[f.key] = card.card?.[f.key] ?? ''
  for (const f of config.physicalNotes ?? []) cardObj[f.key] = card.card?.[f.key] ?? ''
  for (const f of config.listFields ?? []) {
    cardObj[f.key] = Array.isArray(card.card?.[f.key]) ? card.card[f.key] : []
  }
  if (config.portrait) {
    cardObj.portrait_path = card.card?.portrait_path ?? ''
    // Old single-portrait cards (no gallery list yet) normalize to a
    // one-image gallery so no draft save can drop the existing image.
    cardObj.gallery = Array.isArray(card.card?.gallery)
      ? card.card.gallery
      : cardObj.portrait_path
        ? [cardObj.portrait_path]
        : []
  }
  if (config.bookStatus) {
    cardObj.book_status = card.card?.book_status ?? {}
    cardObj.books = Array.isArray(card.card?.books) ? card.card.books : []
    cardObj.introduced_in = card.card?.introduced_in ?? ''
  }
  return { ...top, card: cardObj }
}

function CardEditor({ config, card, onUpdate, onDelete }) {
  const { findReferences, renameReferences, regions, activeProject, activeBookId } = useStore()
  const books = activeProject?.settings?.books ?? []
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

  // One-time migration: pre-gallery cards (portrait_path set, no gallery list)
  // persist the normalized structure on open so every device/row carries it.
  useEffect(() => {
    if (!config.portrait) return
    const c = card.card || {}
    if (c.portrait_path && !Array.isArray(c.gallery)) {
      onUpdate(card.id, { card: { ...c, gallery: [c.portrait_path] } }).catch(() => {})
    }
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
    for (const f of config.topFields) {
      patch[f.key] = next[f.key]
      if (f.legacyKey) patch[f.legacyKey] = next[f.legacyKey]
    }
    if (config.bookStatus) {
      // The legacy top-level column mirrors the FULL-RANGE derived status
      // (latest per-book entry over all books; the column has no constraint) so
      // exports/queries and older readers keep a meaningful single value.
      patch.status = deriveCharacterStatus({ status: card.status, card: next.card }, books)
    }
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
  // Replace several card keys at once (per-book appearance + introduced-in).
  function setCardPatch(patch) {
    setDraft((d) => {
      const next = { ...d, card: { ...d.card, ...patch } }
      persist(next)
      return next
    })
  }
  // Gallery patch: { gallery, portrait_path } — saved immediately (never lose
  // an uploaded path to a pending debounce).
  function setGallery(patch) {
    setDraft((d) => {
      const next = { ...d, card: { ...d.card, ...patch } }
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
        <button className="icon-btn danger" title="Löschen" aria-label="Löschen" onClick={onDelete}>
          <Trash2 size={17} />
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
          gallery={draft.card.gallery}
          onChange={setGallery}
        />
      )}

      {config.bookStatus && (
        <div className="book-status-block">
          <div className="book-status-head">
            <span className="book-status-title">Bücher</span>
            {(() => {
              // As of the ACTIVE book (top-bar dropdown) — same as lists/filters.
              const st = deriveCharacterStatus({ status: card.status, card: draft.card }, books, activeBookId)
              return st ? <span className={`char-status st-${st}`}>Aktuell: {st}</span> : null
            })()}
          </div>
          {books.length === 0 ? (
            <p className="hint">Noch keine Bücher im Projekt — lege in der Übersicht eines an.</p>
          ) : (
            <>
              <p className="hint bs-legend">Häkchen = tritt auf · Stern = wird eingeführt · Auswahl = Status im Buch</p>
              <ul className="book-status-list">
                {books.map((b) => {
                  const appears = (draft.card.books || []).includes(b.id)
                  const introduced = draft.card.introduced_in === b.id
                  return (
                    <li key={b.id} className={activeBookId === b.id ? 'active-book' : ''}>
                      <label className="bs-appear" title={appears ? 'Tritt in diesem Buch auf' : 'Tritt (noch) nicht auf'}>
                        <input
                          type="checkbox"
                          aria-label={`Tritt auf in ${b.title}`}
                          checked={appears}
                          onChange={(e) => {
                            const set = new Set(draft.card.books || [])
                            if (e.target.checked) set.add(b.id)
                            else set.delete(b.id)
                            const patch = { books: [...set] }
                            if (!e.target.checked && introduced) patch.introduced_in = ''
                            setCardPatch(patch)
                          }}
                        />
                      </label>
                      <span className="bs-book" title={b.title}>{b.title}</span>
                      <button
                        type="button"
                        className={`icon-btn sm bs-intro ${introduced ? 'on' : ''}`}
                        title={introduced ? 'Wird in diesem Buch eingeführt (Klick entfernt die Markierung)' : 'Als Einführungsbuch markieren'}
                        aria-label={`Eingeführt in ${b.title}`}
                        onClick={() => {
                          const patch = { introduced_in: introduced ? '' : b.id }
                          if (!introduced) patch.books = [...new Set([...(draft.card.books || []), b.id])]
                          setCardPatch(patch)
                        }}
                      >
                        <Star size={12} />
                      </button>
                      <select
                        aria-label={`Status in ${b.title}`}
                        value={draft.card.book_status?.[b.id] || ''}
                        onChange={(e) => {
                          const next = { ...(draft.card.book_status || {}) }
                          if (e.target.value) next[b.id] = e.target.value
                          else delete next[b.id]
                          setCardField('book_status', next)
                        }}
                      >
                        <option value="">— kein Eintrag —</option>
                        {BOOK_STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          {Object.keys(draft.card.book_status || {}).length === 0 && card.status && (
            <p className="hint">Übernommen vom bisherigen Status: „{card.status}“ — gilt, bis ein Buch einen Eintrag hat.</p>
          )}
        </div>
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
                    {f.labels?.[o] || o}
                  </option>
                ))}
              </select>
            ) : f.type === 'region' ? (
              // Regions dropdown (stored as region_id). A legacy free-text value
              // stays visible below until a region is picked.
              <>
                <select
                  value={draft[f.key] || ''}
                  onChange={(e) => setTop(f.key, e.target.value || null)}
                >
                  <option value="">— Region wählen —</option>
                  {regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {!draft[f.key] && draft[f.legacyKey] && (
                  <span className="hint legacy-hint">
                    Bisheriger Eintrag (Freitext): „{draft[f.legacyKey]}“
                  </span>
                )}
              </>
            ) : f.type === 'region-or-text' ? (
              // Regions dropdown WITH a free-text fallback: no region selected →
              // the free-text input stays visible and editable.
              <>
                <select
                  value={draft[f.key] || ''}
                  onChange={(e) => setTop(f.key, e.target.value || null)}
                >
                  <option value="">— Freitext / keine Region —</option>
                  {regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {!draft[f.key] && (
                  <input
                    type="text"
                    className="legacy-text-input"
                    value={draft[f.legacyKey] || ''}
                    placeholder="Freitext-Herkunft …"
                    onChange={(e) => setTop(f.legacyKey, e.target.value)}
                  />
                )}
              </>
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
                    list={f.suggestions ? `dl-${config.kind}-${f.key}` : undefined}
                    onChange={(e) => setCardField(f.key, e.target.value)}
                  />
                  {f.suggestions && (
                    // Dropdown suggestions + free text in one control (datalist).
                    <datalist id={`dl-${config.kind}-${f.key}`}>
                      {f.suggestions.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  )}
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
