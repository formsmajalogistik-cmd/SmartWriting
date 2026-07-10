import { useMemo, useState } from 'react'
import { Marked } from 'marked'
import { BookOpen } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { makeResolver, hashlinkExtension } from '../lib/hashlinks.js'
import { noBlockquote } from '../lib/markdown.js'
import { groupChaptersByBook } from '../lib/export/markdown.js'
import EmptyState from './EmptyState.jsx'

// Compile view: the whole manuscript assembled for reading, in book → chapter
// order, from each chapter's ACTIVE prose version (chapters.body mirrors it, so
// this matches the export engine exactly). Read per book or the whole project.
export default function CompileView() {
  const { activeProject, chapters, characters, places, regions, geoFeatures } = useStore()
  const [scope, setScope] = useState('all') // 'all' | book id

  const resolver = useMemo(() => makeResolver(characters, places, regions, geoFeatures), [characters, places, regions, geoFeatures])
  const marked = useMemo(() => {
    const m = new Marked({ breaks: true })
    m.use(noBlockquote)
    m.use(hashlinkExtension(resolver))
    return m
  }, [resolver])

  // Same ordering the export engine uses, for consistency.
  const groups = useMemo(
    () => groupChaptersByBook(activeProject, chapters),
    [activeProject, chapters],
  )
  const visibleGroups =
    scope === 'all' ? groups : groups.filter((g) => (g.book ? g.book.id : '__loose') === scope)

  // Render each chapter's body once; memoised so re-renders are cheap.
  const rendered = useMemo(() => {
    const map = new Map()
    for (const g of groups) {
      for (const ch of g.chapters) {
        map.set(ch.id, marked.parse(ch.body || ''))
      }
    }
    return map
  }, [groups, marked])

  if (!chapters.length) {
    return (
      <EmptyState
        title="Noch nichts zu lesen"
        hint="Lege Kapitel an und schreibe los – hier erscheint dein zusammengeführtes Manuskript."
      />
    )
  }

  const totalChapters = visibleGroups.reduce((n, g) => n + g.chapters.length, 0)

  return (
    <div className="compile-view">
      <div className="compile-toolbar">
        <span className="compile-title">
          <BookOpen size={16} /> Manuskript
        </span>
        <select className="compile-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">Ganzes Projekt</option>
          {groups
            .filter((g) => g.book)
            .map((g) => (
              <option key={g.book.id} value={g.book.id}>
                {g.book.title}
              </option>
            ))}
          {groups.some((g) => !g.book) && <option value="__loose">Ohne Buch</option>}
        </select>
        <span className="compile-count">
          {totalChapters} {totalChapters === 1 ? 'Kapitel' : 'Kapitel'}
        </span>
      </div>

      <article className="compile-doc markdown">
        <h1 className="compile-project-title">{activeProject?.name || 'Manuskript'}</h1>
        {visibleGroups.map((g) => (
          <section key={g.book ? g.book.id : '__loose'} className="compile-book">
            {g.book && <h2 className="compile-book-title">{g.book.title}</h2>}
            {g.chapters.map((ch) => (
              <section key={ch.id} className="compile-chapter">
                <h3 className="compile-chapter-title">
                  {ch.number}. {ch.title}
                </h3>
                {ch.body && ch.body.trim() ? (
                  <div dangerouslySetInnerHTML={{ __html: rendered.get(ch.id) }} />
                ) : (
                  <p className="compile-empty-chapter">(noch kein Text)</p>
                )}
              </section>
            ))}
          </section>
        ))}
      </article>
    </div>
  )
}
