import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'

// A searchable add control: type to filter the given options, click one to add
// it, or create a new stub inline when the typed name has no exact match.
//
// Props:
//   placeholder
//   options        — [{ id, name }] of items NOT yet selected
//   onPick(id)     — add an existing item
//   onCreate(name) — create a new stub and add it
export default function AddCombo({ placeholder, options, onPick, onCreate }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)

  const query = q.trim()
  const filtered = useMemo(() => {
    const lc = query.toLowerCase()
    return options.filter((o) => o.name.toLowerCase().includes(lc)).slice(0, 8)
  }, [options, query])
  const exact = options.some((o) => o.name.toLowerCase() === query.toLowerCase())
  const canCreate = query.length > 0 && !exact

  function pick(id) {
    onPick(id)
    setQ('')
    setOpen(false)
  }
  function create() {
    onCreate(query)
    setQ('')
    setOpen(false)
  }

  return (
    <div className="add-combo">
      <input
        type="search"
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (filtered.length > 0 || canCreate) && (
        <ul className="combo-list">
          {filtered.map((o) => (
            <li
              key={o.id}
              className="combo-option"
              onMouseDown={(e) => {
                e.preventDefault()
                pick(o.id)
              }}
            >
              {o.name}
            </li>
          ))}
          {canCreate && (
            <li
              className="combo-create"
              onMouseDown={(e) => {
                e.preventDefault()
                create()
              }}
            >
              <Plus size={14} /> „{query}“ anlegen
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
