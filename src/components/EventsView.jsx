import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, MapPin, User, X } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import AddCombo from './AddCombo.jsx'

// Events view: create / edit / delete event cards. Place and involved
// characters are selectors over existing cards; book + story_order set the
// event's position on the future timeline. chapter_ids link events<->chapters
// (also written from the chapter metadata panel).
export default function EventsView() {
  const {
    events,
    places,
    characters,
    chapters,
    activeProject,
    createEvent,
    updateEvent,
    deleteEvent,
    focusCard,
    consumeFocusCard,
    setView,
    setActiveChapterId,
  } = useStore()

  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')

  // Jump to a specific event when navigated here (e.g. from a link).
  useEffect(() => {
    if (focusCard?.kind === 'event') {
      setSelectedId(focusCard.id)
      consumeFocusCard()
    }
  }, [focusCard, consumeFocusCard])

  const books = activeProject?.settings?.books ?? []
  const bookTitle = (id) => books.find((b) => b.id === id)?.title || '—'

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? events.filter((e) => e.title.toLowerCase().includes(q)) : events
  }, [events, search])

  const selected = events.find((e) => e.id === selectedId) || null

  async function handleCreate() {
    const e = await createEvent('Neues Ereignis')
    if (e) setSelectedId(e.id)
  }

  return (
    <div className="cards-view">
      <div className="cards-list">
        <div className="cards-list-head">
          <input
            className="cards-search"
            type="search"
            placeholder="Ereignisse suchen …"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="toggle primary with-label" onClick={handleCreate}>
            <Plus size={15} /> Neu
          </button>
        </div>
        {visible.length === 0 ? (
          <p className="hint cards-empty">
            {events.length === 0
              ? 'Noch keine Ereignisse. Lege das erste an.'
              : 'Keine Treffer.'}
          </p>
        ) : (
          <ul className="card-items">
            {visible.map((ev) => (
              <li
                key={ev.id}
                className={`card-item ${ev.id === selectedId ? 'active' : ''}`}
                onClick={() => setSelectedId(ev.id)}
              >
                <div className="card-item-main">
                  <span className="card-item-name">{ev.title || '(ohne Titel)'}</span>
                </div>
                <span className="card-item-sub">
                  {[bookTitle(ev.book) !== '—' ? bookTitle(ev.book) : null, `#${ev.story_order ?? 0}`]
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
          <EventEditor
            key={selected.id}
            event={selected}
            books={books}
            places={places}
            characters={characters}
            chapters={chapters}
            onUpdate={updateEvent}
            onDelete={async () => {
              if (window.confirm(`Ereignis „${selected.title}“ löschen?`)) {
                await deleteEvent(selected.id)
                setSelectedId(null)
              }
            }}
            onOpenChapter={(id) => {
              setActiveChapterId(id)
              setView('write')
            }}
          />
        ) : (
          <div className="empty-state card-detail-empty">
            <h2>Kein Ereignis ausgewählt</h2>
            <p>Wähle links ein Ereignis oder lege ein neues an.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function buildDraft(ev) {
  return {
    title: ev.title ?? '',
    book: ev.book ?? '',
    story_order: ev.story_order ?? 0,
    place_id: ev.place_id ?? '',
    description: ev.card?.description ?? '',
    notes: ev.card?.notes ?? '',
    involved_character_ids: Array.isArray(ev.card?.involved_character_ids)
      ? ev.card.involved_character_ids
      : [],
    chapter_ids: Array.isArray(ev.card?.chapter_ids) ? ev.card.chapter_ids : [],
  }
}

function EventEditor({ event, books, places, characters, chapters, onUpdate, onDelete, onOpenChapter }) {
  const { createCharacter, createPlace } = useStore()
  const [draft, setDraft] = useState(() => buildDraft(event))
  const saveTimer = useRef(null)

  useEffect(() => {
    setDraft(buildDraft(event))
  }, [event.id])

  function patchFrom(next) {
    return {
      title: next.title,
      book: next.book || null,
      story_order: Number(next.story_order) || 0,
      place_id: next.place_id || null,
      card: {
        ...event.card,
        description: next.description,
        notes: next.notes,
        involved_character_ids: next.involved_character_ids,
        chapter_ids: next.chapter_ids,
      },
    }
  }
  function save(next) {
    onUpdate(event.id, patchFrom(next)).catch(() => {})
  }
  function persist(next) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(next), 500)
  }
  function persistNow(next) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    save(next)
  }
  useEffect(() => () => saveTimer.current && clearTimeout(saveTimer.current), [])

  function setField(key, value, immediate = false) {
    setDraft((d) => {
      const next = { ...d, [key]: value }
      immediate ? persistNow(next) : persist(next)
      return next
    })
  }

  const byId = (list, id) => list.find((x) => x.id === id)
  const involved = draft.involved_character_ids.map((id) => byId(characters, id)).filter(Boolean)
  const linkedChapters = draft.chapter_ids.map((id) => byId(chapters, id)).filter(Boolean)
  const place = draft.place_id ? byId(places, draft.place_id) : null
  const unselectedChars = characters.filter((c) => !draft.involved_character_ids.includes(c.id))

  return (
    <div className="card-editor">
      <div className="card-editor-head">
        <input
          className="card-name-input"
          value={draft.title}
          placeholder="Titel des Ereignisses"
          onChange={(e) => setField('title', e.target.value)}
        />
        <button className="icon-btn danger" title="Löschen" aria-label="Löschen" onClick={onDelete}>
          <Trash2 size={17} />
        </button>
      </div>

      <div className="card-top-grid">
        <label className="field">
          <span>Buch</span>
          <select value={draft.book || ''} onChange={(e) => setField('book', e.target.value, true)}>
            <option value="">— Buch —</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Reihenfolge (story_order)</span>
          <input
            type="number"
            value={draft.story_order}
            onChange={(e) => setField('story_order', e.target.value)}
          />
        </label>
      </div>

      <div className="card-physical">
        <div className="field">
          <span>Ort</span>
          {place ? (
            <div className="chip-list">
              <span className="chip">
                <span className="chip-label">
                  <MapPin size={14} /> {place.name}
                  {!place.name_final && <span className="badge provisional small">prov.</span>}
                </span>
                <button className="chip-remove" title="Entfernen" onClick={() => setField('place_id', '', true)}>
                  <X size={14} />
                </button>
              </span>
            </div>
          ) : (
            <AddCombo
              placeholder="Ort wählen oder anlegen …"
              options={places}
              onPick={(id) => setField('place_id', id, true)}
              onCreate={async (name) => {
                const p = await createPlace(name)
                if (p) setField('place_id', p.id, true)
              }}
            />
          )}
        </div>

        <div className="field">
          <span>Beteiligte Figuren</span>
          <AddCombo
            placeholder="Figur hinzufügen oder anlegen …"
            options={unselectedChars}
            onPick={(id) =>
              setField('involved_character_ids', [...draft.involved_character_ids, id], true)
            }
            onCreate={async (name) => {
              const c = await createCharacter(name)
              if (c)
                setField('involved_character_ids', [...draft.involved_character_ids, c.id], true)
            }}
          />
          {involved.length > 0 && (
            <ul className="chip-list">
              {involved.map((c) => (
                <li key={c.id} className="chip">
                  <span className="chip-label">
                    <User size={14} /> {c.name}
                    {!c.name_final && <span className="badge provisional small">prov.</span>}
                  </span>
                  <button
                    className="chip-remove"
                    title="Entfernen"
                    onClick={() =>
                      setField(
                        'involved_character_ids',
                        draft.involved_character_ids.filter((id) => id !== c.id),
                        true,
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="field">
          <span>Verknüpfte Kapitel</span>
          {linkedChapters.length === 0 ? (
            <p className="hint">
              Noch keine. Verknüpfe Kapitel im Metadaten-Panel des Kapitels („Ereignisse in diesem
              Kapitel“).
            </p>
          ) : (
            <ul className="chip-list">
              {linkedChapters.map((ch) => (
                <li key={ch.id} className="chip">
                  <button className="chip-link" onClick={() => onOpenChapter(ch.id)}>
                    {ch.number}. {ch.title}
                  </button>
                  <button
                    className="chip-remove"
                    title="Verknüpfung entfernen"
                    onClick={() =>
                      setField('chapter_ids', draft.chapter_ids.filter((id) => id !== ch.id), true)
                    }
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card-rich">
        <label className="field">
          <span>Beschreibung</span>
          <textarea
            rows={3}
            value={draft.description}
            onChange={(e) => setField('description', e.target.value)}
          />
        </label>
        <label className="field">
          <span>Notizen</span>
          <textarea rows={3} value={draft.notes} onChange={(e) => setField('notes', e.target.value)} />
        </label>
      </div>
    </div>
  )
}
