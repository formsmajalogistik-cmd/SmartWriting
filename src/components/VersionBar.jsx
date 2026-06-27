import { useEffect, useState } from 'react'
import { GitBranch, Check, Pencil, Trash2, Columns2, Plus } from 'lucide-react'

// Version toolbar shown inside an open chapter. Lets the writer switch the
// active prose version, snapshot a new one, rename, delete (never the active
// one) and open the side-by-side Compare view. Metadata is untouched here — it
// lives on the single logical chapter, not on a version.
function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}

export default function VersionBar({
  versions,
  activeVersionId,
  onNewVersion,
  onSetActive,
  onRename,
  onDelete,
  onCompare,
}) {
  // Which version the action buttons operate on (defaults to the active one).
  const [selectedId, setSelectedId] = useState(activeVersionId)
  const [busy, setBusy] = useState(false)

  // Keep the selection valid as versions load / change.
  useEffect(() => {
    if (!versions.some((v) => v.id === selectedId)) {
      setSelectedId(activeVersionId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, activeVersionId])

  const selected = versions.find((v) => v.id === selectedId) || null
  const isActiveSelected = selectedId === activeVersionId

  async function run(fn) {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } catch {
      // Surfaced by the global error banner.
    } finally {
      setBusy(false)
    }
  }

  function handleRename() {
    if (!selected) return
    const next = window.prompt('Version umbenennen:', selected.label || '')
    if (next == null) return
    const label = next.trim()
    if (!label || label === selected.label) return
    run(() => onRename(selected.id, label))
  }

  function handleDelete() {
    if (!selected || isActiveSelected) return
    if (!window.confirm(`Version „${selected.label}" löschen? Dies kann nicht rückgängig gemacht werden.`))
      return
    run(async () => {
      await onDelete(selected.id)
      setSelectedId(activeVersionId)
    })
  }

  return (
    <div className="version-bar">
      <span className="version-bar-label">
        <GitBranch size={15} /> Version
      </span>

      <select
        className="version-select"
        value={selectedId || ''}
        onChange={(e) => setSelectedId(e.target.value)}
        disabled={busy || !versions.length}
        title="Version auswählen"
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
            {fmtDate(v.created_at) ? ` · ${fmtDate(v.created_at)}` : ''}
            {v.id === activeVersionId ? ' · aktiv' : ''}
          </option>
        ))}
      </select>

      <button
        className="version-btn"
        onClick={() => run(() => onSetActive(selectedId))}
        disabled={busy || isActiveSelected || !selected}
        title="Ausgewählte Version als aktiv setzen"
      >
        <Check size={15} /> Aktiv setzen
      </button>

      <button
        className="version-btn"
        onClick={() => run(onNewVersion)}
        disabled={busy}
        title="Aktuelle Version als neue Version duplizieren"
      >
        <Plus size={15} /> Neue Version
      </button>

      <button
        className="version-btn"
        onClick={handleRename}
        disabled={busy || !selected}
        title="Version umbenennen"
      >
        <Pencil size={15} /> Umbenennen
      </button>

      <button
        className="version-btn danger"
        onClick={handleDelete}
        disabled={busy || isActiveSelected || !selected}
        title={isActiveSelected ? 'Die aktive Version kann nicht gelöscht werden' : 'Version löschen'}
      >
        <Trash2 size={15} /> Löschen
      </button>

      <button
        className="version-btn"
        onClick={onCompare}
        disabled={busy || versions.length < 2}
        title={versions.length < 2 ? 'Mindestens zwei Versionen nötig' : 'Zwei Versionen vergleichen'}
      >
        <Columns2 size={15} /> Vergleichen
      </button>
    </div>
  )
}
