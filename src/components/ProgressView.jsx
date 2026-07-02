import { useMemo } from 'react'
import { useStore } from '../state/store.jsx'
import { computeProgress } from '../lib/progress.js'

const fmt = (n) => n.toLocaleString('de-DE')

// Read-only writing-progress overview: word count per chapter, per-book
// subtotals, a whole-project total, and a status breakdown. No goals/targets.
export default function ProgressView() {
  const { chapters, activeProject, openChapterAt } = useStore()
  const books = activeProject?.settings?.books ?? []
  const p = useMemo(() => computeProgress(chapters, books), [chapters, books])

  return (
    <div className="progress-view">
      <div className="progress-header">
        <h2>Fortschritt</h2>
        <div className="progress-totals">
          <span className="progress-total-words">{fmt(p.total.words)} Wörter</span>
          <span className="progress-total-sub">
            {p.total.chapterCount} Kapitel · {p.books.length} Buch{p.books.length === 1 ? '' : 'er'}
          </span>
        </div>
      </div>

      <div className="progress-status" role="group" aria-label="Kapitel nach Status">
        {Object.entries(p.byStatus).map(([status, count]) => (
          <span key={status} className={`status-chip status-${status}`}>
            {status} <b>{count}</b>
          </span>
        ))}
      </div>

      {p.total.chapterCount === 0 ? (
        <p className="hint">Noch keine Kapitel. Lege im Schreiben-Bereich eines an.</p>
      ) : (
        <div className="progress-books">
          {p.books.map((b) => (
            <section className="progress-book" key={b.id ?? 'loose'}>
              <div className="progress-book-head">
                <span className="progress-book-title">{b.title}</span>
                <span className="progress-book-sub">
                  {b.chapterCount} Kapitel · <b>{fmt(b.words)}</b> Wörter
                </span>
              </div>
              <ul className="progress-chapters">
                {b.chapters.map((ch) => (
                  <li key={ch.id}>
                    <button
                      type="button"
                      className="progress-chapter"
                      onClick={() => openChapterAt(ch.id)}
                      title="Kapitel öffnen"
                    >
                      <span className="progress-ch-num">{ch.number}</span>
                      <span className="progress-ch-title">{ch.title || 'Kapitel'}</span>
                      {ch.status && <span className={`status-dot status-${ch.status}`} title={ch.status} />}
                      <span className="progress-ch-words">{fmt(ch.words)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
