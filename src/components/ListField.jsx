import { useState } from 'react'
import { Plus, X } from 'lucide-react'

// A repeatable list of short text entries (e.g. recurring descriptors).
// Each entry is removable; new entries are added via the input (Enter or +).
//
// Props:
//   label, placeholder, hint
//   value    — string[]
//   onChange(nextArray)
//   warnOnAdd(value) — optional; returns a confirm() message to show before
//                      adding (null/undefined = add without asking)
export default function ListField({ label, placeholder, hint, value, onChange, warnOnAdd }) {
  const [draft, setDraft] = useState('')
  const items = Array.isArray(value) ? value : []

  function add() {
    const v = draft.trim()
    if (!v) return
    const warning = warnOnAdd?.(v)
    if (warning && !window.confirm(warning)) return
    onChange([...items, v])
    setDraft('')
  }
  function remove(i) {
    onChange(items.filter((_, idx) => idx !== i))
  }

  return (
    <div className="field list-field">
      <span>{label}</span>
      {hint && <p className="hint list-hint">{hint}</p>}
      {items.length > 0 && (
        <ul className="list-entries">
          {items.map((entry, i) => (
            <li key={i} className="list-entry">
              <span>{entry}</span>
              <button
                type="button"
                className="chip-remove"
                title="Entfernen"
                aria-label="Entfernen"
                onClick={() => remove(i)}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="list-add">
        <input
          type="text"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="toggle" onClick={add} disabled={!draft.trim()} aria-label="Hinzufügen">
          <Plus size={15} />
        </button>
      </div>
    </div>
  )
}
