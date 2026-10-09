import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

// A dismissible bottom sheet for narrow screens (phones in portrait).
//   • closed unless opened — the writing surface stays clean;
//   • tap the scrim, press Escape, the ×, or swipe the handle down to close;
//   • sits above the on-screen keyboard (visualViewport) and never takes more
//     than ~70% of the visible height, so the page above stays in view;
//   • rendered in a portal so no scroll container can clip it.
const SWIPE_CLOSE_PX = 80

export default function BottomSheet({ open, onClose, title, header, children }) {
  const [drag, setDrag] = useState(0)
  const start = useRef(null)
  const [vv, setVv] = useState({ bottom: 0, height: typeof window !== 'undefined' ? window.innerHeight : 800 })

  // Keep clear of the mobile keyboard: the visual viewport shrinks when it
  // opens; the sheet docks to its bottom edge and caps its height to it.
  useEffect(() => {
    if (!open) return undefined
    const v = window.visualViewport
    const update = () => {
      if (!v) return setVv({ bottom: 0, height: window.innerHeight })
      setVv({ bottom: Math.max(0, window.innerHeight - (v.height + v.offsetTop)), height: v.height })
    }
    update()
    v?.addEventListener('resize', update)
    v?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      v?.removeEventListener('resize', update)
      v?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) setDrag(0)
  }, [open])

  if (!open) return null

  const onDown = (e) => {
    start.current = e.clientY
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onMove = (e) => {
    if (start.current == null) return
    setDrag(Math.max(0, e.clientY - start.current))
  }
  const onUp = () => {
    if (start.current == null) return
    start.current = null
    if (drag > SWIPE_CLOSE_PX) onClose()
    else setDrag(0)
  }

  return createPortal(
    <div className="sheet-root">
      <div className="sheet-scrim" onClick={onClose} />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          bottom: vv.bottom,
          maxHeight: Math.round(vv.height * 0.7),
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: drag ? 'none' : undefined,
        }}
      >
        <div
          className="sheet-grip"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          title="Nach unten ziehen zum Schließen"
        >
          <span className="sheet-handle" />
        </div>
        <div className="sheet-head">
          {header}
          <button type="button" className="icon-btn sheet-close" aria-label="Schließen" title="Schließen" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
