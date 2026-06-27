import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store.jsx'
import Editor from './Editor.jsx'
import MetadataPanel from './MetadataPanel.jsx'
import VersionBar from './VersionBar.jsx'
import CompareModal from './CompareModal.jsx'

// The writing surface: chapter title, version toolbar, the Markdown editor, and
// a toggleable metadata panel. Body edits are kept in local state and saved
// debounced into the ACTIVE version (chapters.body mirrors it) so typing never
// blocks on the data layer. Metadata stays on the single logical chapter.
export default function ChapterView() {
  const {
    activeChapter,
    chapterVersions,
    saveChapterBody,
    createVersion,
    renameVersion,
    deleteVersion,
    setActiveVersion,
  } = useStore()
  const [body, setBody] = useState(activeChapter?.body ?? '')
  const [preview, setPreview] = useState(false)
  const [showMeta, setShowMeta] = useState(true)
  const [saved, setSaved] = useState(true)
  const [compareOpen, setCompareOpen] = useState(false)
  const saveTimer = useRef(null)
  // Latest body, so flushing before a version op writes what's on screen.
  const bodyRef = useRef(body)
  bodyRef.current = body

  const chapterId = activeChapter?.id
  const activeVersionId = activeChapter?.active_version_id

  // Reset the editor when the chapter OR its active version changes (e.g. after
  // "Set as active" / "New version"): the prose differs, the metadata does not.
  useEffect(() => {
    setBody(activeChapter?.body ?? '')
    setSaved(true)
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, activeVersionId])

  function onBodyChange(next) {
    setBody(next)
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null
      try {
        await saveChapterBody(chapterId, next)
        setSaved(true)
      } catch {
        // Failure is surfaced by the global error banner; keep the indicator
        // in the "speichert …" state so the unsaved change is visible.
      }
    }, 500)
  }

  // Write any pending edit to the active version NOW. Version operations call
  // this first so the freshly typed prose is never lost or written to the wrong
  // version. Returns the body that is now persisted.
  async function flushBody() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const current = bodyRef.current
    if (!saved) {
      await saveChapterBody(chapterId, current)
      setSaved(true)
    }
    return current
  }

  // "New version": snapshot the current active prose into a fresh version and
  // switch to it, so the original stays frozen while you experiment.
  async function handleNewVersion() {
    const current = await flushBody()
    const v = await createVersion(chapterId, { body: current })
    await setActiveVersion(chapterId, v.id)
  }

  async function handleSetActive(versionId) {
    if (versionId === activeVersionId) return
    await flushBody()
    await setActiveVersion(chapterId, versionId)
  }

  async function handleRename(versionId, label) {
    await renameVersion(versionId, label, chapterId)
  }

  async function handleDelete(versionId) {
    await deleteVersion(versionId, chapterId)
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

      <VersionBar
        versions={chapterVersions}
        activeVersionId={activeVersionId}
        onNewVersion={handleNewVersion}
        onSetActive={handleSetActive}
        onRename={handleRename}
        onDelete={handleDelete}
        onCompare={() => setCompareOpen(true)}
      />

      <div className="chapter-main">
        <Editor value={body} onChange={onBodyChange} preview={preview} />
        {showMeta && (
          <aside className="meta-aside">
            <MetadataPanel chapter={activeChapter} />
          </aside>
        )}
      </div>

      {compareOpen && (
        <CompareModal
          versions={chapterVersions}
          activeVersionId={activeVersionId}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </div>
  )
}
