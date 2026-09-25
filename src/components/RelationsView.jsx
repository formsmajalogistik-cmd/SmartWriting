import { Suspense, lazy, useMemo, useState } from 'react'
import { Loader2, Network, Trees, X } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { CHARACTER_CONFIG } from './cardConfig.js'
import { REL_TYPES, buildGraph, derivedForWithUncertainty, relationsOf } from '../lib/relationships.js'

// The graph pane (SVG + layouts) is loaded on demand — the overview is a big
// view that most sessions never open.
const RelationsGraph = lazy(() => import('./relations/RelationsGraph.jsx'))

// BEZIEHUNGEN — the project-wide relationship overview.
// Two modes: the full network (everything, including derived family links) and
// "nur Familie", which lays the family edges out as a proper tree, generations
// from top to bottom.
export default function RelationsView() {
  const { characters, relationships, activeProject, activeBookId, openCard } = useStore()
  const books = activeProject?.settings?.books ?? []

  const [types, setTypes] = useState([]) // [] = all
  const [group, setGroup] = useState('') // '' = all subtab groups
  const [bookFilter, setBookFilter] = useState('__active__')
  const [familyOnly, setFamilyOnly] = useState(false)
  const [showDerived, setShowDerived] = useState(true)
  const [showUncertain, setShowUncertain] = useState(true)
  const [focusId, setFocusId] = useState(null)
  const [focusDepth, setFocusDepth] = useState(1)

  const bookId = bookFilter === '__active__' ? activeBookId : bookFilter || null
  const groupDef = CHARACTER_CONFIG.subtabs.find((t) => t.key === group) || null

  const graph = useMemo(
    () =>
      buildGraph({
        characters,
        relationships,
        types: types.length ? types : null,
        groupMatch: groupDef ? groupDef.match : null,
        bookId,
        showUncertain,
        showDerived,
        familyOnly,
        focusId,
        focusDepth,
      }),
    [characters, relationships, types, groupDef, bookId, showUncertain, showDerived, familyOnly, focusId, focusDepth],
  )

  const focusChar = focusId ? characters.find((c) => c.id === focusId) : null
  const toggleType = (key) =>
    setTypes((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))

  return (
    <div className="relations-view">
      <div className="rel-bar">
        <nav className="seg" aria-label="Darstellung">
          <button className={`seg-btn ${familyOnly ? '' : 'on'}`} onClick={() => setFamilyOnly(false)}>
            <Network size={14} /> Netzwerk
          </button>
          <button className={`seg-btn ${familyOnly ? 'on' : ''}`} onClick={() => setFamilyOnly(true)}>
            <Trees size={14} /> nur Familie
          </button>
        </nav>
        <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Gruppe">
          <option value="">Alle Figuren</option>
          {CHARACTER_CONFIG.subtabs.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <select value={bookFilter} onChange={(e) => setBookFilter(e.target.value)} aria-label="Nach Buch filtern">
          <option value="__active__">Aktives Buch</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
          <option value="">Alle Bücher</option>
        </select>
        {!familyOnly && (
          <label className="checkbox">
            <input type="checkbox" checked={showDerived} onChange={(e) => setShowDerived(e.target.checked)} />
            <span>abgeleitete Verwandtschaft</span>
          </label>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={showUncertain} onChange={(e) => setShowUncertain(e.target.checked)} />
          <span>unsichere / geheime</span>
        </label>
        <span className="rel-counts">
          {graph.nodes.length} Figuren · {graph.edges.length} Verbindungen
        </span>
      </div>

      <div className="rel-types">
        <span className="rel-types-label">Typen:</span>
        <button className={`names-chip ${types.length === 0 ? 'on' : ''}`} onClick={() => setTypes([])}>
          alle
        </button>
        {REL_TYPES.filter((t) => !familyOnly || t.family).map((t) => (
          <button
            key={t.key}
            className={`names-chip ${types.includes(t.key) ? 'on' : ''}`}
            title={t.hint || t.label}
            onClick={() => toggleType(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {focusChar && (
        <div className="rel-focus-bar">
          <span>
            Fokus: <b>{focusChar.name}</b>
          </span>
          <select value={focusDepth} onChange={(e) => setFocusDepth(Number(e.target.value))} aria-label="Fokus-Tiefe">
            <option value={1}>direkte Verbindungen</option>
            <option value={2}>zwei Schritte</option>
            <option value={3}>drei Schritte</option>
          </select>
          <button className="toggle" onClick={() => openCard('character', focusChar.id)}>
            Karte öffnen
          </button>
          <button className="icon-btn" title="Fokus aufheben" aria-label="Fokus aufheben" onClick={() => setFocusId(null)}>
            <X size={15} />
          </button>
        </div>
      )}

      <p className="hint rel-legend">
        Klick auf eine Figur öffnet ihre Karte; das kleine Kreuz am Knoten zeigt nur deren Umgebung.
        Ziehen verschiebt, Mausrad zoomt. Durchgezogen = eingetragen, gestrichelt = abgeleitet
        (Großeltern, Cousins, Schwägerschaft …), gepunktet = unsicher/geheim.
        {familyOnly && ' Im Familienmodus stehen die Generationen von oben nach unten.'}
      </p>

      {graph.nodes.length === 0 ? (
        <p className="hint rel-empty">
          {characters.length === 0
            ? 'Noch keine Figuren im Projekt.'
            : 'Keine Figuren passen zu diesen Filtern.'}
        </p>
      ) : (
        <Suspense
          fallback={
            <div className="rel-loading">
              <Loader2 className="spin" size={20} /> Beziehungsgrafik wird geladen …
            </div>
          }
        >
          <RelationsGraph
            nodes={graph.nodes}
            edges={graph.edges}
            relationships={relationships}
            familyOnly={familyOnly}
            focusId={focusId}
            onFocus={setFocusId}
            onOpen={(id) => openCard('character', id)}
          />
        </Suspense>
      )}

      <RelationTally characters={characters} relationships={relationships} />
    </div>
  )
}

// A quiet footer: who has no relationship at all yet, so the overview also
// tells you what is still missing.
function RelationTally({ characters, relationships }) {
  const lonely = characters.filter(
    (c) => relationsOf(c.id, relationships).length === 0 && derivedForWithUncertainty(c.id, relationships).length === 0,
  )
  if (!characters.length || !lonely.length) return null
  return (
    <p className="hint rel-tally">
      Ohne Beziehungen: {lonely.map((c) => c.name).join(', ')}
    </p>
  )
}
