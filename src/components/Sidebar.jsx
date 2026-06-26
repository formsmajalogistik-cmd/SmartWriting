import { Plus, Pencil, Trash2 } from 'lucide-react'
import { useStore } from '../state/store.jsx'

// Per-project Book -> Chapter tree. Create/rename/delete books and chapters.
// Clicking a chapter opens it instantly.
export default function Sidebar({ onChapterPick }) {
  const {
    activeProject,
    chapters,
    activeChapterId,
    setActiveChapterId,
    createBook,
    renameBook,
    deleteBook,
    createChapter,
    renameChapter,
    deleteChapter,
  } = useStore()

  const books = activeProject?.settings?.books ?? []
  const chaptersByBook = (bookId) =>
    chapters.filter((c) => c.book === bookId).sort((a, b) => a.number - b.number)
  const looseChapters = chaptersByBook(null)

  function openChapter(id) {
    setActiveChapterId(id)
    onChapterPick?.()
  }

  async function addBook() {
    const title = window.prompt('Titel des neuen Buchs:')
    if (title && title.trim()) await createBook(title.trim())
  }

  async function addChapter(bookId) {
    const title = window.prompt('Titel des neuen Kapitels:')
    await createChapter({ book: bookId, title: title?.trim() || undefined })
  }

  return (
    <div className="tree">
      <div className="tree-header">
        <span>Bücher &amp; Kapitel</span>
        <button className="icon-btn with-label" title="Neues Buch" onClick={addBook}>
          <Plus size={15} /> Buch
        </button>
      </div>

      {books.length === 0 && looseChapters.length === 0 && (
        <p className="tree-empty">Noch keine Bücher. Lege eines an, um Kapitel zu schreiben.</p>
      )}

      {books.map((book) => (
        <div className="book" key={book.id}>
          <div className="book-row">
            <span className="book-title">{book.title}</span>
            <span className="row-actions">
              <button className="icon-btn" title="Kapitel hinzufügen" aria-label="Kapitel hinzufügen" onClick={() => addChapter(book.id)}>
                <Plus size={16} />
              </button>
              <button
                className="icon-btn"
                title="Buch umbenennen"
                aria-label="Buch umbenennen"
                onClick={async () => {
                  const t = window.prompt('Buch umbenennen:', book.title)
                  if (t && t.trim()) await renameBook(book.id, t.trim())
                }}
              >
                <Pencil size={15} />
              </button>
              <button
                className="icon-btn danger"
                title="Buch löschen"
                aria-label="Buch löschen"
                onClick={async () => {
                  if (window.confirm(`Buch „${book.title}“ und alle seine Kapitel löschen?`))
                    await deleteBook(book.id)
                }}
              >
                <Trash2 size={15} />
              </button>
            </span>
          </div>
          <ChapterList
            list={chaptersByBook(book.id)}
            activeChapterId={activeChapterId}
            openChapter={openChapter}
            renameChapter={renameChapter}
            deleteChapter={deleteChapter}
          />
        </div>
      ))}

      {looseChapters.length > 0 && (
        <div className="book">
          <div className="book-row">
            <span className="book-title muted">Ohne Buch</span>
          </div>
          <ChapterList
            list={looseChapters}
            activeChapterId={activeChapterId}
            openChapter={openChapter}
            renameChapter={renameChapter}
            deleteChapter={deleteChapter}
          />
        </div>
      )}
    </div>
  )
}

function ChapterList({ list, activeChapterId, openChapter, renameChapter, deleteChapter }) {
  if (list.length === 0) return <p className="tree-empty small">— keine Kapitel —</p>
  return (
    <ul className="chapter-list">
      {list.map((ch) => (
        <li
          key={ch.id}
          className={`chapter-row ${ch.id === activeChapterId ? 'active' : ''}`}
          onClick={() => openChapter(ch.id)}
        >
          <span className="chapter-name">
            <span className="chapter-num">{ch.number}</span>
            {ch.title}
          </span>
          <span className={`status-dot status-${ch.status}`} title={ch.status} />
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="icon-btn"
              title="Kapitel umbenennen"
              aria-label="Kapitel umbenennen"
              onClick={async () => {
                const t = window.prompt('Kapitel umbenennen:', ch.title)
                if (t && t.trim()) await renameChapter(ch.id, t.trim())
              }}
            >
              <Pencil size={15} />
            </button>
            <button
              className="icon-btn danger"
              title="Kapitel löschen"
              aria-label="Kapitel löschen"
              onClick={async () => {
                if (window.confirm(`Kapitel „${ch.title}“ löschen?`)) await deleteChapter(ch.id)
              }}
            >
              <Trash2 size={15} />
            </button>
          </span>
        </li>
      ))}
    </ul>
  )
}
