import { useMemo, useState } from 'react'
import { Search, User, MapPin, CalendarClock, ArrowRight } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { searchManuscript } from '../lib/search.js'

// Manuscript-wide search: matches the active-version body of every chapter
// (case-insensitive), with highlighted snippets and jump-to. Card names match
// too, shown in a separate section.
export default function SearchView() {
  const { chapters, characters, places, events, activeProject, openChapterAt, openCard } = useStore()
  const [query, setQuery] = useState('')
  const books = activeProject?.settings?.books ?? []

  const results = useMemo(
    () => searchManuscript(query, { chapters, books, characters, places, events }),
    [query, chapters, books, characters, places, events],
  )

  const bookTitle = (id) => books.find((b) => b.id === id)?.title || null
  const chapterLabel = (r) => {
    const bt = bookTitle(r.book)
    const num = r.number != null ? `${r.number}. ` : ''
    return `${bt ? `${bt} · ` : ''}${num}${r.title || 'Kapitel'}`
  }
  const totalHits = results.chapters.reduce((n, r) => n + r.count, 0)
  const cardIcon = { character: User, place: MapPin, event: CalendarClock }

  return (
    <div className="search-view">
      <div className="search-head">
        <div className="search-box">
          <Search size={16} />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Im ganzen Manuskript suchen …"
            aria-label="Manuskript durchsuchen"
          />
        </div>
        {query.trim() && (
          <span className="search-summary">
            {totalHits} Treffer in {results.chapters.length} Kapitel
            {results.cards.length > 0 ? ` · ${results.cards.length} Karten` : ''}
          </span>
        )}
      </div>

      {!query.trim() ? (
        <p className="hint search-hint">Tippe, um alle Kapitel des Projekts zu durchsuchen.</p>
      ) : results.chapters.length === 0 && results.cards.length === 0 ? (
        <p className="hint search-hint">Keine Treffer für „{query.trim()}“.</p>
      ) : (
        <div className="search-results">
          {results.chapters.length > 0 && (
            <section className="search-section">
              <h3 className="search-section-title">Kapiteltext</h3>
              {results.chapters.map((r) => (
                <div className="search-chapter" key={r.chapterId}>
                  <button
                    type="button"
                    className="search-chapter-head"
                    onClick={() => openChapterAt(r.chapterId, r.snippets[0]?.start ?? null, r.snippets[0]?.end ?? null)}
                    title="Kapitel öffnen"
                  >
                    <span className="search-chapter-name">{chapterLabel(r)}</span>
                    <span className="search-count">{r.count}</span>
                  </button>
                  <ul className="search-snippets">
                    {r.snippets.map((s, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          className="search-snippet"
                          onClick={() => openChapterAt(r.chapterId, s.start, s.end)}
                          title="Zur Fundstelle springen"
                        >
                          <span className="snippet-text">
                            {s.pre}
                            <mark>{s.match}</mark>
                            {s.post}
                          </span>
                          <ArrowRight size={13} className="snippet-go" />
                        </button>
                      </li>
                    ))}
                    {r.count > r.snippets.length && (
                      <li className="search-more">+{r.count - r.snippets.length} weitere im Kapitel</li>
                    )}
                  </ul>
                </div>
              ))}
            </section>
          )}

          {results.cards.length > 0 && (
            <section className="search-section">
              <h3 className="search-section-title">Karten (Namen)</h3>
              <ul className="search-cards">
                {results.cards.map((c) => {
                  const Icon = cardIcon[c.kind] || User
                  return (
                    <li key={`${c.kind}-${c.id}`}>
                      <button
                        type="button"
                        className="search-card"
                        onClick={() => openCard(c.kind, c.id)}
                        title="Karte öffnen"
                      >
                        <Icon size={14} />
                        <span className={c.name_final ? '' : 'prov'}>{c.name || '(ohne Namen)'}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
