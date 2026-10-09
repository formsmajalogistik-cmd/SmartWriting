import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PanelRightClose } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { countWords } from '../lib/progress.js'
import Editor from './Editor.jsx'
import MetadataPanel from './MetadataPanel.jsx'
import ChapterCastPanel from './ChapterCastPanel.jsx'
import BottomSheet from './BottomSheet.jsx'
import { panelMode } from './chapterLayout.js'
import VersionBar from './VersionBar.jsx'
import CompareModal from './CompareModal.jsx'

// ---- side panels: Metadaten + Figuren im Kapitel ---------------------------
// The layout rule (split / tabs / drawer) lives in chapterLayout.js; which
// panels are shown (and the last tab) is remembered per device.
const PANELS_KEY = 'smartwriting.chapterPanels'
const PANEL_DEFAULTS = { meta: true, cast: true, side: true, tab: 'meta' }

function loadPanels() {
  try {
    return { ...PANEL_DEFAULTS, ...JSON.parse(localStorage.getItem(PANELS_KEY) || '{}') }
  } catch {
    return { ...PANEL_DEFAULTS }
  }
}
function columnWidth() {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--editor-page-w').trim()
  const rem = raw.endsWith('rem') ? parseFloat(raw) : 42
  return rem * root
}

// The writing surface: chapter title, version toolbar, the Markdown editor, and
// the metadata + character panels. Body edits are kept in local state and saved
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
    focusMatch,
    consumeFocusMatch,
    locations,
  } = useStore()
  const [body, setBody] = useState(activeChapter?.body ?? '')
  const [preview, setPreview] = useState(false)
  const [panels, setPanelsState] = useState(loadPanels)
  const setPanels = useCallback((patch) => {
    setPanelsState((cur) => {
      const next = { ...cur, ...patch }
      try {
        localStorage.setItem(PANELS_KEY, JSON.stringify(next))
      } catch {
        /* per-device convenience only */
      }
      return next
    })
  }, [])
  // The drawer is never remembered open: the writing surface starts clean.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const mainRef = useRef(null)
  const [mode, setMode] = useState('split')
  useLayoutEffect(() => {
    const el = mainRef.current
    if (!el) return undefined
    const measure = () => setMode(panelMode(el.getBoundingClientRect().width, columnWidth()))
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [activeChapter?.id])
  useEffect(() => {
    if (mode !== 'drawer') setDrawerOpen(false)
  }, [mode])
  const [saved, setSaved] = useState(true)
  const [compareOpen, setCompareOpen] = useState(false)
  const saveTimer = useRef(null)
  // Latest body, so flushing before a version op writes what's on screen.
  const bodyRef = useRef(body)
  bodyRef.current = body

  const chapterId = activeChapter?.id
  const activeVersionId = activeChapter?.active_version_id
  const wordCount = useMemo(() => countWords(body), [body])
  // A pending search jump for THIS chapter, handed to the editor to select.
  const focusSelection = focusMatch && focusMatch.chapterId === chapterId ? focusMatch : null

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

  // Incoming sync: when a pull updated this chapter's prose while nothing is
  // being typed here (saved === true), show the pulled body. This never fires
  // mid-typing — a locally-pending edit is routed through the conflict logic
  // instead of being overwritten.
  useEffect(() => {
    if (saved && activeChapter && (activeChapter.body ?? '') !== bodyRef.current) {
      setBody(activeChapter.body ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChapter?.body])

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

  const castCount = useMemo(() => {
    if (!chapterId) return 0
    return new Set(locations.filter((l) => l.chapter_id === chapterId && l.character_id).map((l) => l.character_id)).size
  }, [locations, chapterId])

  // Is a panel visible right now, in the current layout?
  const shown = (key) =>
    mode === 'split' ? !!panels[key] : mode === 'tabs' ? panels.side && panels.tab === key : drawerOpen && panels.tab === key
  // Toolbar buttons: toggle a panel (split), switch/close the tabbed sidebar
  // (tabs), or open the drawer on that tab (drawer).
  function togglePanel(key) {
    if (mode === 'split') return setPanels({ [key]: !panels[key] })
    if (mode === 'tabs') {
      if (panels.side && panels.tab === key) return setPanels({ side: false })
      return setPanels({ side: true, tab: key })
    }
    if (drawerOpen && panels.tab === key) return setDrawerOpen(false)
    setPanels({ tab: key })
    setDrawerOpen(true)
  }
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  if (!activeChapter) return null

  const panelTabs = (
    <nav className="seg panel-tabs" aria-label="Seitenleiste">
      <button
        type="button"
        className={`seg-btn ${panels.tab === 'meta' ? 'on' : ''}`}
        aria-pressed={panels.tab === 'meta'}
        onClick={() => setPanels({ tab: 'meta' })}
      >
        Metadaten
      </button>
      <button
        type="button"
        className={`seg-btn ${panels.tab === 'cast' ? 'on' : ''}`}
        aria-pressed={panels.tab === 'cast'}
        onClick={() => setPanels({ tab: 'cast' })}
      >
        Figuren{castCount ? ` (${castCount})` : ''}
      </button>
    </nav>
  )
  const panelBody =
    panels.tab === 'cast' ? (
      <ChapterCastPanel chapter={activeChapter} body={body} />
    ) : (
      <MetadataPanel chapter={activeChapter} />
    )

  return (
    <div className="chapter-view">
      <div className="chapter-toolbar">
        <div className="chapter-title">
          <span className="chapter-num-badge">{activeChapter.number}</span>
          <h2>{activeChapter.title}</h2>
          <span className={`save-state ${saved ? 'ok' : 'pending'}`}>
            {saved ? 'gespeichert' : 'speichert …'}
          </span>
          <span className="chapter-words" title="Wörter (aktive Version)">
            {wordCount.toLocaleString('de-DE')} Wörter
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
            className={`toggle ${shown('meta') ? 'on' : ''}`}
            onClick={() => togglePanel('meta')}
            title="Kapitel-Metadaten"
            aria-pressed={shown('meta')}
          >
            Metadaten
          </button>
          <button
            className={`toggle ${shown('cast') ? 'on' : ''}`}
            onClick={() => togglePanel('cast')}
            title="Figuren im Kapitel"
            aria-pressed={shown('cast')}
          >
            Figuren{castCount ? ` (${castCount})` : ''}
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

      <div className={`chapter-main mode-${mode}`} ref={mainRef} data-panel-mode={mode}>
        <Editor
          value={body}
          onChange={onBodyChange}
          preview={preview}
          focusSelection={focusSelection}
          onFocusApplied={consumeFocusMatch}
        />
        {mode === 'split' && panels.meta && (
          <aside className="meta-aside" aria-label="Kapitel-Metadaten">
            <MetadataPanel chapter={activeChapter} />
          </aside>
        )}
        {mode === 'split' && panels.cast && (
          <aside className="meta-aside cast-aside" aria-label="Figuren im Kapitel">
            <ChapterCastPanel chapter={activeChapter} body={body} />
          </aside>
        )}
        {mode === 'tabs' && panels.side && (
          <aside className="meta-aside side-tabs" aria-label="Kapitel-Seitenleiste">
            <div className="side-tabs-head">
              {panelTabs}
              <button
                type="button"
                className="icon-btn"
                title="Seitenleiste einklappen"
                aria-label="Seitenleiste einklappen"
                onClick={() => setPanels({ side: false })}
              >
                <PanelRightClose size={16} />
              </button>
            </div>
            {panelBody}
          </aside>
        )}
      </div>

      <BottomSheet
        open={mode === 'drawer' && drawerOpen}
        onClose={closeDrawer}
        title={panels.tab === 'cast' ? 'Figuren im Kapitel' : 'Kapitel-Metadaten'}
        header={panelTabs}
      >
        {panelBody}
      </BottomSheet>

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
