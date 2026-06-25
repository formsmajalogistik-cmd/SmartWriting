import { useStore } from '../state/store.jsx'

// Project list + switcher: create, rename, delete, and select the active
// project. Selecting scopes the entire UI to that project.
export default function ProjectSwitcher() {
  const {
    projects,
    activeProject,
    activeProjectId,
    setActiveProjectId,
    createProject,
    renameProject,
    deleteProject,
  } = useStore()

  async function handleSelect(e) {
    const val = e.target.value
    if (val === '__new__') {
      const name = window.prompt('Name des neuen Projekts:')
      if (name && name.trim()) await createProject(name.trim())
    } else {
      setActiveProjectId(val)
    }
  }

  async function handleRename() {
    if (!activeProject) return
    const name = window.prompt('Projekt umbenennen:', activeProject.name)
    if (name && name.trim()) await renameProject(activeProject.id, name.trim())
  }

  async function handleDelete() {
    if (!activeProject) return
    if (
      window.confirm(
        `Projekt „${activeProject.name}“ und alle Bücher, Kapitel und Worldbuilding-Daten löschen? Dies kann nicht rückgängig gemacht werden.`,
      )
    ) {
      await deleteProject(activeProject.id)
    }
  }

  return (
    <div className="project-switcher">
      <select value={activeProjectId || ''} onChange={handleSelect} aria-label="Projekt">
        {projects.length === 0 && <option value="">— kein Projekt —</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option value="__new__">＋ Neues Projekt …</option>
      </select>
      {activeProject && (
        <>
          <button className="icon-btn" title="Projekt umbenennen" onClick={handleRename}>
            ✎
          </button>
          <button className="icon-btn danger" title="Projekt löschen" onClick={handleDelete}>
            🗑
          </button>
        </>
      )}
    </div>
  )
}
