import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Footprints, MessageCircle, User, X } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { ROLE_LABELS } from '../data/types.js'
import { deriveCharacterStatus } from '../lib/characterStatus.js'
import { primaryImagePath } from '../lib/portraits.js'
import { makeResolver } from '../lib/hashlinks.js'
import { chapterCast, unlinkedTextMentions } from '../lib/presence.js'
import { aliasWarning } from '../lib/aliases.js'
import AddCombo from './AddCombo.jsx'
import ListField from './ListField.jsx'

// FIGUREN IM KAPITEL — everyone linked to the open chapter, grouped into
// "anwesend" and "erwähnt", with the continuity details you need while writing
// (age, species, height, recurring descriptors, habits, aliases) one click
// away and editable in place. Adds characters (existing or a new stub) and
// suggests the ones the text #-mentions but that aren't linked yet — a
// suggestion only, nothing is ever linked automatically.
export default function ChapterCastPanel({ chapter, body }) {
  const {
    characters,
    places,
    regions,
    geoFeatures,
    locations,
    createCharacter,
    setCharacterPresent,
  } = useStore()
  const [addAs, setAddAs] = useState('anwesend')
  const [open, setOpen] = useState(() => new Set())

  const cast = useMemo(() => chapterCast(chapter.id, locations, characters), [chapter.id, locations, characters])
  const unlinked = useMemo(() => characters.filter((c) => !cast.linked.has(c.id)), [characters, cast])

  // Text-mention suggestions follow the live text, deferred so typing stays
  // fast even in long chapters.
  const deferredBody = useDeferredValue(body ?? chapter.body ?? '')
  const resolver = useMemo(
    () => makeResolver(characters, places, regions, geoFeatures),
    [characters, places, regions, geoFeatures],
  )
  const suggestions = useMemo(
    () => unlinkedTextMentions(deferredBody, resolver, cast.linked),
    [deferredBody, resolver, cast.linked],
  )

  const toggle = (id) =>
    setOpen((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function add(id, presence = addAs) {
    await setCharacterPresent(chapter.id, id, true, presence)
  }
  async function createAndAdd(name) {
    const c = await createCharacter(name)
    if (c) await add(c.id)
  }

  const total = cast.present.length + cast.mentioned.length

  return (
    <div className="cast-panel">
      <h3>
        Figuren im Kapitel <span className="count">{total}</span>
      </h3>

      <div className="cast-add">
        <nav className="seg cast-add-mode" aria-label="Hinzufügen als">
          <button
            type="button"
            className={`seg-btn ${addAs === 'anwesend' ? 'on' : ''}`}
            onClick={() => setAddAs('anwesend')}
          >
            <Footprints size={13} /> anwesend
          </button>
          <button
            type="button"
            className={`seg-btn ${addAs === 'erwaehnt' ? 'on' : ''}`}
            onClick={() => setAddAs('erwaehnt')}
          >
            <MessageCircle size={13} /> erwähnt
          </button>
        </nav>
        <AddCombo
          placeholder="Figur suchen oder anlegen …"
          options={unlinked}
          onPick={(id) => add(id)}
          onCreate={createAndAdd}
        />
      </div>

      {suggestions.length > 0 && (
        <div className="cast-suggest" role="note">
          <p className="cast-suggest-head">Im Text erwähnt, nicht verknüpft — hinzufügen?</p>
          <ul>
            {suggestions.map((s) => (
              <li key={s.id} className="cast-suggest-row">
                <span className="cast-suggest-name" title={s.written !== s.name ? `im Text: #${s.written}` : undefined}>
                  {s.name}
                </span>
                <button type="button" className="toggle sm" onClick={() => add(s.id, 'erwaehnt')}>
                  als erwähnt
                </button>
                <button type="button" className="toggle sm" onClick={() => add(s.id, 'anwesend')}>
                  als anwesend
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <CastGroup
        title="Anwesend"
        list={cast.present}
        chapter={chapter}
        presence="anwesend"
        open={open}
        onToggle={toggle}
        empty="Niemand anwesend."
      />
      <CastGroup
        title="Erwähnt"
        list={cast.mentioned}
        chapter={chapter}
        presence="erwaehnt"
        open={open}
        onToggle={toggle}
        empty="Niemand nur erwähnt."
      />
    </div>
  )
}

function CastGroup({ title, list, chapter, presence, open, onToggle, empty }) {
  return (
    <section className={`cast-group ${presence}`}>
      <h4>
        {title} <span className="count">{list.length}</span>
      </h4>
      {list.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        list.map((c) => (
          <CastCard
            key={c.id}
            character={c}
            chapter={chapter}
            presence={presence}
            expanded={open.has(c.id)}
            onToggle={() => onToggle(c.id)}
          />
        ))
      )}
    </section>
  )
}

function CastCard({ character: c, chapter, presence, expanded, onToggle }) {
  const {
    activeProject,
    activeBookId,
    setCharacterPresent,
    setCharacterPresence,
    patchCharacterCard,
    openCard,
    characters,
    places,
    regions,
    geoFeatures,
  } = useStore()
  const books = activeProject?.settings?.books ?? []
  const status = deriveCharacterStatus(c, books, activeBookId)
  const role = ROLE_LABELS[c.role] || c.role || ''
  const portrait = usePortrait(c)
  const mentioned = presence === 'erwaehnt'

  // Quick edit: merged into the freshest card by the store (serialised per
  // character), so no other field — and no quick earlier edit — is lost.
  const saveCard = (patch) => patchCharacterCard(c.id, patch).catch(() => {})
  const list = (key) => (Array.isArray(c.card?.[key]) ? c.card[key] : [])

  return (
    <article className={`cast-card ${expanded ? 'open' : ''} ${mentioned ? 'mentioned' : ''}`}>
      <header className="cast-card-head">
        <span className="cast-thumb" aria-hidden="true">
          {portrait ? <img src={portrait} alt="" /> : <User size={18} />}
        </span>
        <button type="button" className="cast-id" onClick={onToggle} aria-expanded={expanded}>
          <span className={`cast-name ${c.name_final ? '' : 'provisional'}`}>
            {c.name}
            {!c.name_final && <span className="badge provisional small">prov.</span>}
          </span>
          <span className="cast-sub">
            {[role, status].filter(Boolean).join(' · ') || '—'}
          </span>
        </button>
        <button
          type="button"
          className="icon-btn presence-switch"
          title={mentioned ? 'Anwesend (mit Ort)' : 'Nur erwähnt (kein Ort, keine Kartenmarke)'}
          aria-label={mentioned ? `${c.name} als anwesend markieren` : `${c.name} als erwähnt markieren`}
          onClick={() => setCharacterPresence(chapter.id, c.id, mentioned ? 'anwesend' : 'erwaehnt')}
        >
          {mentioned ? <Footprints size={15} /> : <MessageCircle size={15} />}
        </button>
        <button
          type="button"
          className="icon-btn cast-expand"
          title={expanded ? 'Einklappen' : 'Kontinuität anzeigen'}
          aria-label={expanded ? 'Einklappen' : 'Kontinuität anzeigen'}
          onClick={onToggle}
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
      </header>

      {expanded && (
        <div className="cast-details">
          <div className="cast-grid">
            <QuickField label="Alter" value={c.card?.age} onSave={(v) => saveCard({ age: v })} />
            <QuickField label="Spezies" value={c.card?.species} onSave={(v) => saveCard({ species: v })} />
            <QuickField label="Größe" value={c.card?.height} onSave={(v) => saveCard({ height: v })} />
          </div>
          <ListField
            label="Wiederkehrende Beschreibungen"
            placeholder="z. B. „Narbe über der Braue“"
            value={list('recurring_descriptors')}
            onChange={(arr) => saveCard({ recurring_descriptors: arr })}
          />
          <QuickField
            label="Angewohnheiten / Manierismen"
            value={c.card?.habits}
            multiline
            onSave={(v) => saveCard({ habits: v })}
          />
          <ListField
            label="Aliase / weitere Namen"
            placeholder="z. B. Beiname …"
            value={list('aliases')}
            onChange={(arr) => saveCard({ aliases: arr })}
            warnOnAdd={(v) =>
              aliasWarning(v, {
                selfId: c.id,
                selfAliases: list('aliases'),
                characters,
                places,
                regions,
                geoFeatures,
              })
            }
          />
          <div className="cast-actions">
            <button type="button" className="toggle" onClick={() => openCard('character', c.id)}>
              <ExternalLink size={14} /> Karte öffnen
            </button>
            <button
              type="button"
              className="toggle"
              onClick={() => setCharacterPresent(chapter.id, c.id, false)}
              title="Verknüpfung mit diesem Kapitel lösen"
            >
              <X size={14} /> Aus Kapitel entfernen
            </button>
          </div>
        </div>
      )}
    </article>
  )
}

// A text field that saves on blur (and Enter for single lines) — never per
// keystroke. Keyed on the stored value so an edit made elsewhere shows up.
function QuickField({ label, value, onSave, multiline = false }) {
  const stored = value ?? ''
  const commit = (e) => {
    const v = e.target.value
    if (v !== stored) onSave(v)
  }
  return (
    <label className="field cast-field">
      <span>{label}</span>
      {multiline ? (
        <textarea key={stored} rows={2} defaultValue={stored} onBlur={commit} />
      ) : (
        <input
          key={stored}
          type="text"
          defaultValue={stored}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      )}
    </label>
  )
}

// The primary portrait as an object/signed URL (revoked when it changes).
function usePortrait(character) {
  const { getPortraitUrl } = useStore()
  const path = primaryImagePath(character)
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let cancelled = false
    let objectUrl = null
    if (!path) {
      setUrl(null)
      return undefined
    }
    getPortraitUrl(path)
      .then((u) => {
        if (cancelled) return
        if (u && u.startsWith('blob:')) objectUrl = u
        setUrl(u)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path, getPortraitUrl])
  return url
}
