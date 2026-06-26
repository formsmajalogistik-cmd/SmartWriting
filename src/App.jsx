import { useState } from 'react'
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

  return (
    <div className="app">
      <header className="topbar">
        {view === 'write' && (
          <button
            className="icon-btn sidebar-toggle"
            aria-label="Menü"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            ☰
          </button>
        )}
        <span className="brand">SmartWriting</span>
        {activeProject && (
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
            ● speichert …
          </span>
        )}
        <ProjectSwitcher />
        <div className="account">
          <span className="account-email" title={user?.email}>
            {user?.email}
          </span>
          <button className="icon-btn" title="Abmelden" onClick={() => signOut()}>
            Abmelden
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <span>⚠ {error}</span>
          <button className="icon-btn" onClick={clearError} aria-label="Schließen">
            ✕
          </button>
        </div>
      )}

      <div className="body">
        {!activeProject ? (
          <main className="content">
            <EmptyState
              title="Kein Projekt ausgewählt"
              hint="Erstelle oben rechts ein Projekt, um zu beginnen."
            />
          </main>
        ) : view === 'characters' ? (
          <main className="content">
            <CharactersView />
          </main>
        ) : view === 'places' ? (
          <main className="content">
            <PlacesView />
          </main>
        ) : view === 'events' ? (
          <main className="content">
            <EventsView />
          </main>
        ) : view === 'names' ? (
          <main className="content">
            <NamesView />
          </main>
        ) : (
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
        )}
      </div>
    </div>
  )
}
