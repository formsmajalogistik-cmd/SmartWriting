import { useState } from 'react'
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

const VIEWS = [
  { key: 'write', label: 'Schreiben' },
  { key: 'characters', label: 'Figuren' },
  { key: 'places', label: 'Orte' },
  { key: 'events', label: 'Ereignisse' },
  { key: 'names', label: 'Namen' },
]

export default function App() {
  const { ready, activeProject, activeChapter, saving, error, clearError, view, setView } = useStore()
  const { user, signOut } = useAuth()
  // Mobile: sidebar slides over the writing surface.
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (!ready) {
    return <div className="app-loading">Lädt …</div>
  }

  function renderBody() {
    if (view === 'profile') {
      return (
        <main className="content">
          <ProfileView />
        </main>
      )
    }
    if (!activeProject) {
      return (
        <main className="content">
          <EmptyState
            title="Kein Projekt ausgewählt"
            hint="Erstelle oben rechts ein Projekt, um zu beginnen."
          />
        </main>
      )
    }
    if (view === 'characters') return <main className="content"><CharactersView /></main>
    if (view === 'places') return <main className="content"><PlacesView /></main>
    if (view === 'events') return <main className="content"><EventsView /></main>
    if (view === 'names') return <main className="content"><NamesView /></main>
    return (
      <>
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <Sidebar onChapterPick={() => setSidebarOpen(false)} />
        </aside>
        {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}
        <main className="content">
          {activeChapter ? (
            <ChapterView key={activeChapter.id} />
          ) : (
            <EmptyState
              title="Kein Kapitel geöffnet"
              hint="Wähle links ein Kapitel oder lege ein neues an."
            />
          )}
        </main>
      </>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        {view === 'write' && activeProject && (
          <button
            className="icon-btn sidebar-toggle"
            aria-label="Menü"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <Menu size={18} />
          </button>
        )}
        <span className="brand">SmartWriting</span>
        {activeProject && view !== 'profile' && (
          <nav className="view-nav">
            {VIEWS.map((v) => (
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
        {saving && (
          <span className="sync-indicator" title="Speichert …">
            <Loader2 size={13} className="spin" /> speichert …
          </span>
        )}
        <ProjectSwitcher />
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

      <div className="body">{renderBody()}</div>
    </div>
  )
}
