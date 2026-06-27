import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { diffLines } from '../lib/lineDiff.js'

// Side-by-side comparison of two prose versions, with changed/added/removed
// lines highlighted. Line-level LCS diff — readable and fast for chapter text.
export default function CompareModal({ versions, activeVersionId, onClose }) {
  // Sensible defaults: newest vs the active version (fall back to the first two).
  const initialRight = activeVersionId || versions[versions.length - 1]?.id
  const initialLeft =
    versions.find((v) => v.id !== initialRight)?.id || versions[0]?.id

  const [leftId, setLeftId] = useState(initialLeft)
  const [rightId, setRightId] = useState(initialRight)

  const left = versions.find((v) => v.id === leftId) || null
  const right = versions.find((v) => v.id === rightId) || null

  const diff = useMemo(
    () => diffLines(left?.body ?? '', right?.body ?? ''),
    [left?.body, right?.body],
  )

  const label = (v) =>
    v ? `${v.label}${v.id === activeVersionId ? ' (aktiv)' : ''}` : '—'

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal compare-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Versionen vergleichen</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">
            <X size={18} />
          </button>
        </div>

        <div className="compare-pickers">
          <select value={leftId || ''} onChange={(e) => setLeftId(e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {label(v)}
              </option>
            ))}
          </select>
          <span className="compare-vs">↔</span>
          <select value={rightId || ''} onChange={(e) => setRightId(e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {label(v)}
              </option>
            ))}
          </select>
        </div>

        {!diff.changed && !diff.truncated && (
          <p className="compare-note">Diese beiden Versionen sind identisch.</p>
        )}
        {diff.truncated && (
          <p className="compare-note">
            Sehr langer Text – zeilenweiser Abgleich nach Position (vereinfacht).
          </p>
        )}

        <div className="compare-grid" role="table" aria-label="Versionsvergleich">
          {diff.rows.map((row, i) => (
            <div className="compare-row" key={i}>
              <div className={`compare-cell left ${row.type}`}>
                {row.left == null ? <span className="empty-line" /> : row.left || ' '}
              </div>
              <div className={`compare-cell right ${row.type}`}>
                {row.right == null ? <span className="empty-line" /> : row.right || ' '}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
