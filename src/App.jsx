import { useEffect, useState } from 'react'
import { Menu, Loader2, AlertTriangle, X, LogOut, UserCog } from 'lucide-react'
import { useStore } from './state/store.jsx'
import { useAuth } from './auth/AuthProvider.jsx'
import ProjectSwitcher from './components/ProjectSwitcher.jsx'
import Sidebar from './components/Sidebar.jsx'
import ChapterView from './components/ChapterView.jsx'
import EmptyState from './components/EmptyState.jsx'
import CharactersView from './components/CharactersView.jsx'
import PlacesView from './components/PlacesView.jsx'
import EventsView from './components/EventsView.jsx'
import NamesView from './components/NamesView.jsx'
import ProfileView from './components/ProfileView.jsx'
import ExportView from './components/ExportView.jsx'
import CompileView from './components/CompileView.jsx'
import MapView from './components/MapView.jsx'
import SearchView from './components/SearchView.jsx'
import ProgressView from './components/ProgressView.jsx'
import SyncStatus from './components/SyncStatus.jsx'
import PraemaliView from './components/PraemaliView.jsx'

// Section navigation lives in the collapsible LEFT sidebar. The two big
// workspaces (Karte, Praemali) and the manuscript CONTEXT (project / book /
// chapter selectors) live in the TOP bar. Version controls stay in the editor.
const NAV_VIEWS = [
  { key: 'write', label: 'Schreiben' },
  { key: 'overview', label: 'Übersicht' },
  { key: 'compile', label: 'Manuskript' },
  { key: 'search', label: 'Suche' },
  { key: 'progress', label: 'Fortschritt' },
  { key: 'characters', label: 'Figuren' },
  { key: 'places', label: 'Orte' },
  { key: 'events', label: 'Ereignisse' },
  { key: 'names', label: 'Namen' },
  { key: 'export', label: 'Export' },
]
const TOP_VIEWS = [
  { key: 'map', label: 'Karte' },
  { key: 'praemali', label: 'Praemali' },
]

const NAV_OPEN_KEY = 'smartwriting.navOpen'
const isNarrow = () => window.matchMedia('(max-width: 820px)').matches

// Book + chapter dropdowns in the top bar. The shown book follows the active
// chapter; picking a different book only re-scopes the chapter dropdown until
// a chapter is actually opened.
function ManuscriptSelectors() {
  const { activeProject, chapters, activeChapter, setActiveChapterId, setView } = useStore()
  const [bookPick, setBookPick] = useState(null)
  useEffect(() => setBookPick(null), [activeChapter?.id, activeProject?.id])
  if (!activeProject) return null

  const books = activeProject.settings?.books ?? []
  const loose = chapters.filter((c) => c.book == null)
  const currentBook =
    bookPick ??
    (activeChapter
      ? activeChapter.book ?? '__none__'
      : books[0]?.id ?? (loose.length ? '__none__' : ''))
  const list = chapters
    .filter((c) => (currentBook === '__none__' ? c.book == null : c.book === currentBook))
    .sort((a, b) => a.number - b.number)
  const chapterValue =
    activeChapter && (activeChapter.book ?? '__none__') === currentBook ? activeChapter.id : ''

  return (
    <div className="manuscript-nav">
      <select
        aria-label="Buch"
        value={currentBook}
        onChange={(e) => setBookPick(e.target.value)}
        disabled={books.length === 0 && loose.length === 0}
      >
        {books.length === 0 && loose.length === 0 && <option value="">— kein Buch —</option>}
        {books.map((b) => (
          <option key={b.id} value={b.id}>
            {b.title}
          </option>
        ))}
        {loose.length > 0 && <option value="__none__">Ohne Buch</option>}
      </select>
      <select
        aria-label="Kapitel"
        value={chapterValue}
        onChange={(e) => {
          if (!e.target.value) return
          setActiveChapterId(e.target.value)
          setView('write')
        }}
        disabled={list.length === 0}
      >
        <option value="">{list.length ? '— Kapitel —' : '— keine Kapitel —'}</option>
        {list.map((c) => (
          <option key={c.id} value={c.id}>
            {c.number}. {c.title}
          </option>
        ))}
      </select>
    </div>
  )
}

export default function App() {
  const { ready, activeProject, activeChapter, saving, error, clearError, view, setView } = useStore()
  const { user, signOut } = useAuth()
  // Collapsible left nav sidebar; state remembered. On narrow screens it
  // overlays the content and starts closed regardless of the stored state.
  const [navOpen, setNavOpen] = useState(() => !isNarrow() && localStorage.getItem(NAV_OPEN_KEY) !== '0')
  useEffect(() => {
    localStorage.setItem(NAV_OPEN_KEY, navOpen ? '1' : '0')
  }, [navOpen])

  if (!ready) {
    return <div className="app-loading">Lädt …</div>
  }

  function goTo(key) {
    setView(key)
    if (isNarrow()) setNavOpen(false)
  }

  function renderView() {
    if (view === 'profile') return <ProfileView />
    if (!activeProject) {
      return (
        <EmptyState
          title="Kein Projekt ausgewählt"
          hint="Erstelle oben ein Projekt, um zu beginnen."
        />
      )
    }
    if (view === 'overview') {
      return (
        <div className="overview-pane">
          <Sidebar onChapterPick={() => goTo('write')} />
        </div>
      )
    }
    if (view === 'compile') return <CompileView />
    if (view === 'search') return <SearchView />
    if (view === 'progress') return <ProgressView />
    if (view === 'characters') return <CharactersView />
    if (view === 'places') return <PlacesView />
    if (view === 'events') return <EventsView />
    if (view === 'map') return <MapView />
    if (view === 'praemali') return <PraemaliView />
    if (view === 'names') return <NamesView />
    if (view === 'export') return <ExportView />
    return activeChapter ? (
      <ChapterView key={activeChapter.id} />
    ) : (
      <EmptyState
        title="Kein Kapitel geöffnet"
        hint="Wähle oben ein Kapitel oder öffne die Übersicht."
      />
    )
  }

  const showNav = activeProject && view !== 'profile'

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="icon-btn sidebar-toggle"
          aria-label="Menü"
          title="Menü"
          onClick={() => setNavOpen((v) => !v)}
        >
          <Menu size={18} />
        </button>
        <span className="brand">Lumini Writing</span>
        <ProjectSwitcher />
        <ManuscriptSelectors />
        {activeProject && view !== 'profile' && (
          <nav className="view-nav" aria-label="Arbeitsbereiche">
            {TOP_VIEWS.map((v) => (
              <button
                key={v.key}
                className={`nav-tab ${view === v.key ? 'on' : ''}`}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </button>
            ))}
          </nav>
        )}
        <span className="topbar-spacer" />
        {saving && (
          <span className="sync-indicator" title="Speichert …">
            <Loader2 size={13} className="spin" /> speichert …
          </span>
        )}
        <SyncStatus />
        <div className="account">
          <span className="account-email" title={user?.email}>
            {user?.email}
          </span>
          <button
            className={`icon-btn ${view === 'profile' ? 'on' : ''}`}
            title="Profil"
            aria-label="Profil"
            onClick={() => setView('profile')}
          >
            <UserCog size={18} />
          </button>
          <button className="icon-btn" title="Abmelden" aria-label="Abmelden" onClick={() => signOut()}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <span className="error-banner-msg">
            <AlertTriangle size={15} /> {error}
          </span>
          <button className="icon-btn" onClick={clearError} aria-label="Schließen">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="body">
        {showNav && (
          <>
            <aside className={`nav-sidebar ${navOpen ? 'open' : ''}`}>
              <nav aria-label="Bereiche">
                {NAV_VIEWS.map((v) => (
                  <button
                    key={v.key}
                    className={`nav-tab ${view === v.key ? 'on' : ''}`}
                    onClick={() => goTo(v.key)}
                  >
                    {v.label}
                  </button>
                ))}
              </nav>
            </aside>
            {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
          </>
        )}
        <main className={`content ${view === 'map' ? 'map-content' : ''}`}>{renderView()}</main>
      </div>
    </div>
  )
}
