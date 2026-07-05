import { useMemo, useRef, useState } from 'react'
import { Marked } from 'marked'
import { Plus, Search, Pin, Pencil, Trash2, Check, X } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { noBlockquote } from '../lib/markdown.js'

// IDEEN — brainstorming scratchpad for the active project. Frictionless quick
// capture on top (type + Enter), below it the idea list: pinned first, then
// newest first. Inline edit, pin/unpin, delete, short tags, and a search box
// that matches text OR tags. Content renders light Markdown when not editing.

const md = new Marked({ gfm: true, breaks: true })
md.use(noBlockquote)

const firstLine = (text) => (text || '').split('\n')[0].trim()
const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return ''
  }
}

function TagEditor({ tags, onChange }) {
  const [draft, setDraft] = useState('')
  const commit = () => {
    const t = draft.trim()
    if (t && !tags.includes(t)) onChange([...tags, t])
    setDraft('')
  }
  return (
    <div className="idea-tags-input">
      {tags.map((t) => (
        <span key={t} className="idea-tag">
          {t}
          <button type="button" aria-label={`Tag ${t} entfernen`} onClick={() => onChange(tags.filter((x) => x !== t))}>
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit() } }}
        onBlur={commit}
        placeholder={tags.length ? '' : 'Tag + Enter …'}
        aria-label="Tag hinzufügen"
      />
    </div>
  )
}

// Quick capture: one prominent box, Enter saves (Shift+Enter = newline).
function QuickCapture() {
  const { createIdea } = useStore()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)

  async function capture() {
    const content = text.trim()
    if (!content || busy) return
    setBusy(true)
    try {
      await createIdea({ content })
      setText('')
      ref.current?.focus()
    } catch {
      /* surfaced via the global error banner; the text stays for retry */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="idea-capture">
      <textarea
        ref={ref}
        autoFocus
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            capture()
          }
        }}
        placeholder="Neue Idee festhalten … (Enter speichert, Shift+Enter für Zeilenumbruch)"
        aria-label="Neue Idee"
      />
      <button type="button" className="toggle primary" disabled={!text.trim() || busy} onClick={capture}>
        <Plus size={14} /> Festhalten
      </button>
    </div>
  )
}

function IdeaCard({ idea, onTagClick }) {
  const { updateIdea, deleteIdea } = useStore()
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState(idea.title || '')
  const [content, setContent] = useState(idea.content || '')
  const [tags, setTags] = useState(idea.tags || [])
  const [busy, setBusy] = useState(false)

  const heading = idea.title?.trim() || firstLine(idea.content) || '(leer)'
  // When the first content line doubles as the heading, don't repeat it below.
  const previewSource = idea.title?.trim()
    ? idea.content
    : (idea.content || '').split('\n').slice(1).join('\n')
  const html = useMemo(() => {
    try {
      return md.parse(previewSource || '')
    } catch {
      return ''
    }
  }, [previewSource])

  function startEdit() {
    setTitle(idea.title || '')
    setContent(idea.content || '')
    setTags(idea.tags || [])
    setEditing(true)
  }
  async function save() {
    if (busy) return
    setBusy(true)
    try {
      await updateIdea(idea.id, { title: title.trim(), content, tags })
      setEditing(false)
    } catch {
      /* surfaced via the global error banner; stay in edit mode (nothing lost) */
    } finally {
      setBusy(false)
    }
  }
  async function togglePin() {
    try {
      await updateIdea(idea.id, { pinned: !idea.pinned })
    } catch {
      /* surfaced via the global error banner */
    }
  }
  async function remove() {
    if (!window.confirm('Idee löschen?')) return
    try {
      await deleteIdea(idea.id)
    } catch {
      /* surfaced via the global error banner */
    }
  }

  if (editing) {
    return (
      <li className="idea-card editing">
        <input
          className="idea-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titel (optional)"
          aria-label="Titel"
        />
        <textarea
          className="idea-content-input"
          rows={5}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          aria-label="Inhalt"
        />
        <TagEditor tags={tags} onChange={setTags} />
        <div className="idea-actions">
          <button type="button" className="toggle primary" disabled={busy || (!content.trim() && !title.trim())} onClick={save}>
            <Check size={14} /> Speichern
          </button>
          <button type="button" className="toggle" onClick={() => setEditing(false)}>
            Abbrechen
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className={`idea-card ${idea.pinned ? 'pinned' : ''}`}>
      <div className="idea-head">
        <button
          type="button"
          className={`icon-btn idea-pin ${idea.pinned ? 'on' : ''}`}
          title={idea.pinned ? 'Nicht mehr anheften' : 'Anheften'}
          aria-label={idea.pinned ? 'Nicht mehr anheften' : 'Anheften'}
          onClick={togglePin}
        >
          <Pin size={14} />
        </button>
        <span className="idea-title">{heading}</span>
        <span className="idea-date">{fmtDate(idea.created_at)}</span>
        <span className="row-actions">
          <button type="button" className="icon-btn" title="Bearbeiten" aria-label="Bearbeiten" onClick={startEdit}>
            <Pencil size={14} />
          </button>
          <button type="button" className="icon-btn danger" title="Löschen" aria-label="Löschen" onClick={remove}>
            <Trash2 size={14} />
          </button>
        </span>
      </div>
      {(idea.tags || []).length > 0 && (
        <div className="idea-tagrow">
          {idea.tags.map((t) => (
            <button key={t} type="button" className="idea-tag clickable" title={`Nach „${t}“ filtern`} onClick={() => onTagClick(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      {html && (
        <div
          className={`idea-body ${expanded ? '' : 'clamped'}`}
          onClick={() => setExpanded((v) => !v)}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </li>
  )
}

export default function IdeasView() {
  const { ideas } = useStore()
  const [q, setQ] = useState('')

  const shown = useMemo(() => {
    const needle = q.toLowerCase().trim()
    const list = needle
      ? ideas.filter((i) =>
          `${i.title || ''} ${i.content || ''}`.toLowerCase().includes(needle) ||
          (i.tags || []).some((t) => t.toLowerCase().includes(needle)))
      : ideas
    // repo returns newest first; float pinned ideas on top (stable within groups)
    return [...list.filter((i) => i.pinned), ...list.filter((i) => !i.pinned)]
  }, [ideas, q])

  return (
    <div className="ideas-view">
      <div className="ideas-inner">
        <h2>Ideen</h2>
        <QuickCapture />
        <div className="search-box ideas-search">
          <Search size={15} />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ideen durchsuchen (Text oder Tag) …"
            aria-label="Ideen durchsuchen"
          />
        </div>
        <ul className="ideas-list">
          {shown.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} onTagClick={setQ} />
          ))}
        </ul>
        {!ideas.length && (
          <p className="hint">Noch keine Ideen — halte oben deinen ersten Gedanken fest.</p>
        )}
        {ideas.length > 0 && !shown.length && (
          <p className="hint">Keine Treffer für „{q.trim()}“.</p>
        )}
      </div>
    </div>
  )
}
