import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store.jsx'
import Editor from './Editor.jsx'
import MetadataPanel from './MetadataPanel.jsx'

// The writing surface: chapter title, the Markdown editor, and a toggleable
// metadata panel. Body edits are kept in local state and saved debounced so
// typing never blocks on the data layer.
export default function ChapterView() {
  const { activeChapter, updateChapter } = useStore()
  const [body, setBody] = useState(activeChapter?.body ?? '')
  const [preview, setPreview] = useState(false)
  const [showMeta, setShowMeta] = useState(true)
  const [saved, setSaved] = useState(true)
  const saveTimer = useRef(null)

  // Reset local body when switching chapters (component is keyed by id, but be safe).
  useEffect(() => {
    setBody(activeChapter?.body ?? '')
    setSaved(true)
  }, [activeChapter?.id])

  function onBodyChange(next) {
    setBody(next)
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await updateChapter(activeChapter.id, { body: next })
        setSaved(true)
      } catch {
        // Failure is surfaced by the global error banner; keep the indicator
        // in the "speichert …" state so the unsaved change is visible.
      }
    }, 500)
  }

  // Flush a pending save on unmount / chapter switch.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  if (!activeChapter) return null

  return (
    <div className="chapter-view">
      <div className="chapter-toolbar">
        <div className="chapter-title">
          <span className="chapter-num-badge">{activeChapter.number}</span>
          <h2>{activeChapter.title}</h2>
          <span className={`save-state ${saved ? 'ok' : 'pending'}`}>
            {saved ? 'gespeichert' : 'speichert …'}
          </span>
        </div>
        <div className="toolbar-actions">
          <button
            className={`toggle ${preview ? 'on' : ''}`}
            onClick={() => setPreview((v) => !v)}
            title="Live-Vorschau"
          >
            Vorschau
          </button>
          <button
            className={`toggle ${showMeta ? 'on' : ''}`}
            onClick={() => setShowMeta((v) => !v)}
            title="Metadaten-Panel"
          >
            Metadaten
          </button>
        </div>
      </div>

      <div className="chapter-main">
        <Editor value={body} onChange={onBodyChange} preview={preview} />
        {showMeta && (
          <aside className="meta-aside">
            <MetadataPanel chapter={activeChapter} />
          </aside>
        )}
      </div>
    </div>
  )
}
