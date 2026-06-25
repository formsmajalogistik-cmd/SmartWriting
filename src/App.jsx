import { useState } from 'react'
import { useStore } from './state/store.jsx'
import ProjectSwitcher from './components/ProjectSwitcher.jsx'
import Sidebar from './components/Sidebar.jsx'
import ChapterView from './components/ChapterView.jsx'
import EmptyState from './components/EmptyState.jsx'

export default function App() {
  const { ready, activeProject, activeChapter } = useStore()
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
        <ProjectSwitcher />
      </header>

      <div className="body">
        {activeProject ? (
          <>
            <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
              <Sidebar onChapterPick={() => setSidebarOpen(false)} />
            </aside>
            {sidebarOpen && (
              <div className="scrim" onClick={() => setSidebarOpen(false)} />
            )}
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
