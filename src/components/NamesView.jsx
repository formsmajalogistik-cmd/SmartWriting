import { useMemo } from 'react'
import { User, MapPin, Check } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { makeResolver, extractHashRefs, KIND_LABELS_DE } from '../lib/hashlinks.js'

// Project-wide "names to finalize or fix": every UNRESOLVED #reference (typo or
// not-yet-carded), every AMBIGUOUS one (several cards share the name — the app
// never guesses), and every resolved link to a card whose name is not final.
// Alias-resolved references count as resolved and are NOT flagged.
export default function NamesView() {
  const { chapters, characters, places, regions, geoFeatures, setActiveChapterId, setView, openCard, openOnMap } = useStore()

  const { unresolved, ambiguous, provisional } = useMemo(() => {
    const resolver = makeResolver(characters, places, regions, geoFeatures)
    const unresolvedMap = new Map() // name -> Set(chapterId)
    const ambiguousMap = new Map() // name -> { name, matches, chapters:Set }
    const provisionalMap = new Map() // cardId -> { card, name, chapters:Set }
    for (const ch of chapters) {
      for (const ref of extractHashRefs(ch.body || '', resolver)) {
        if (ref.ambiguous) {
          const key = ref.name.toLowerCase()
          if (!ambiguousMap.has(key))
            ambiguousMap.set(key, { name: ref.name, matches: ref.matches, chapters: new Set() })
          ambiguousMap.get(key).chapters.add(ch.id)
        } else if (!ref.resolved) {
          const key = ref.name.toLowerCase()
          if (!unresolvedMap.has(key)) unresolvedMap.set(key, { name: ref.name, chapters: new Set() })
          unresolvedMap.get(key).chapters.add(ch.id)
        } else if (ref.provisional) {
          const k = ref.card.id
          if (!provisionalMap.has(k))
            provisionalMap.set(k, { card: ref.card, name: ref.card.name, chapters: new Set() })
          provisionalMap.get(k).chapters.add(ch.id)
        }
      }
    }
    return {
      unresolved: [...unresolvedMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
      ambiguous: [...ambiguousMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
      provisional: [...provisionalMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    }
  }, [chapters, characters, places, regions, geoFeatures])

  const chapterById = (id) => chapters.find((c) => c.id === id)
  function openChapter(id) {
    setActiveChapterId(id)
    setView('write')
  }

  function ChapterChips({ ids }) {
    return (
      <span className="names-chapters">
        {[...ids].map((id) => {
          const ch = chapterById(id)
          if (!ch) return null
          return (
            <button key={id} className="names-chip" onClick={() => openChapter(id)}>
              {ch.number}. {ch.title}
            </button>
          )
        })}
      </span>
    )
  }

  return (
    <div className="names-view">
      <div className="names-inner">
        <h2>Namen prüfen &amp; finalisieren</h2>

        <section className="names-section">
          <h3>
            Unaufgelöste Referenzen <span className="count">{unresolved.length}</span>
          </h3>
          <p className="hint">
            <code>#Name</code> ohne passende Karte — Tippfehler oder noch nicht angelegt.
          </p>
          {unresolved.length === 0 ? (
            <p className="hint names-clear">
              <Check size={15} /> Keine.
            </p>
          ) : (
            <ul className="names-list">
              {unresolved.map((u) => (
                <li key={u.name} className="names-row">
                  <span className="hashlink unresolved static">#{u.name}</span>
                  <ChapterChips ids={u.chapters} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="names-section">
          <h3>
            Mehrdeutige Referenzen <span className="count">{ambiguous.length}</span>
          </h3>
          <p className="hint">
            Mehrere Karten tragen diesen Namen (doppelter Alias oder Namenskollision) — die App rät
            nicht. Benenne um oder entferne den doppelten Alias.
          </p>
          {ambiguous.length === 0 ? (
            <p className="hint names-clear">
              <Check size={15} /> Keine.
            </p>
          ) : (
            <ul className="names-list">
              {ambiguous.map((a) => (
                <li key={a.name} className="names-row">
                  <span className="hashlink ambiguous static">#{a.name}</span>
                  <span className="names-matches">
                    {a.matches.map((m) => (
                      <button
                        key={m._kind + m.id}
                        className="names-chip names-match"
                        title="Karte öffnen"
                        onClick={() =>
                          m._kind === 'character' || m._kind === 'place'
                            ? openCard(m._kind, m.id)
                            : openOnMap(m._kind, m.id)
                        }
                      >
                        {m.name} ({KIND_LABELS_DE[m._kind] || m._kind})
                      </button>
                    ))}
                  </span>
                  <ChapterChips ids={a.chapters} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="names-section">
          <h3>
            Provisorische Namen <span className="count">{provisional.length}</span>
          </h3>
          <p className="hint">Verlinkte Karten, deren Name noch nicht final ist.</p>
          {provisional.length === 0 ? (
            <p className="hint">Keine.</p>
          ) : (
            <ul className="names-list">
              {provisional.map((p) => (
                <li key={p.card.id} className="names-row">
                  <button
                    className="hashlink resolved provisional static as-button"
                    onClick={() => openCard(p.card._kind, p.card.id)}
                    title="Karte öffnen"
                  >
                    {p.card._kind === 'character' ? <User size={13} /> : <MapPin size={13} />} #
                    {p.name}
                  </button>
                  <ChapterChips ids={p.chapters} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
