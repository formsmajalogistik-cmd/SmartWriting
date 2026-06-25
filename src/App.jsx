import { useState } from 'react'
import { useStore } from './state/store.jsx'
import { useAuth } from './auth/AuthProvider.jsx'
import ProjectSwitcher from './components/ProjectSwitcher.jsx'
import Sidebar from './components/Sidebar.jsx'
import ChapterView from './components/ChapterView.jsx'
import EmptyState from './components/EmptyState.jsx'

export default function App() {
  const { ready, activeProject, activeChapter, saving, error, clearError } = useStore()
  const { user, signOut } = useAuth()
  // Mobile: sidebar slides over the writing surface.
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (!ready) {
    return <div className="app-loading">Lädt …</div>
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="icon-btn sidebar-toggle"
          aria-label="Menü"
          onClick={() => setSidebarOpen((v) => !v)}
        >
          ☰
        </button>
        <span className="brand">SmartWriting</span>
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
        {activeProject ? (
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
        ) : (
          <main className="content">
            <EmptyState
              title="Kein Projekt ausgewählt"
              hint="Erstelle oben rechts ein Projekt, um zu beginnen."
            />
          </main>
        )}
      </div>
    </div>
  )
}
