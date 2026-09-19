import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { User, MapPin, Flag, Mountain, Plus } from 'lucide-react'
import { useStore } from '../state/store.jsx'

// "Turn an unresolved #Name into a card" — one click, four kinds.
// The name in the prose is never touched: the new card simply carries it, so
// every existing #reference to it resolves the moment the card exists.
export const CARD_KINDS = [
  { kind: 'character', label: 'Figur', Icon: User },
  { kind: 'place', label: 'Ort', Icon: MapPin },
  { kind: 'region', label: 'Region', Icon: Flag },
  { kind: 'geo', label: 'Geografie', Icon: Mountain },
]

// Create the card with `name` prefilled and open it for editing (regions and
// geo features live on the map, so those open in their map manager).
export function useCreateCardFromName() {
  const { createCharacter, createPlace, createRegion, createGeoFeature, openCard, openOnMap } =
    useStore()
  return useCallback(
    async (kind, rawName) => {
      const name = (rawName || '').trim()
      if (!name) return null
      if (kind === 'character') {
        const row = await createCharacter(name)
        openCard('character', row.id)
        return row
      }
      if (kind === 'place') {
        const row = await createPlace(name)
        openCard('place', row.id)
        return row
      }
      if (kind === 'region') {
        const row = await createRegion({ name })
        openOnMap('region', row.id)
        return row
      }
      const row = await createGeoFeature({ name })
      openOnMap('geo', row.id)
      return row
    },
    [createCharacter, createPlace, createRegion, createGeoFeature, openCard, openOnMap],
  )
}

// The four kind buttons. `busy` blocks a double-click from creating two cards.
function KindButtons({ name, onDone }) {
  const createFromName = useCreateCardFromName()
  const [busy, setBusy] = useState(false)
  return (
    <>
      {CARD_KINDS.map(({ kind, label, Icon }) => (
        <button
          key={kind}
          type="button"
          className="create-card-opt"
          disabled={busy}
          title={`»${name}« als ${label} anlegen und öffnen`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={async () => {
            if (busy) return
            setBusy(true)
            try {
              await createFromName(kind, name)
              onDone?.()
            } finally {
              setBusy(false)
            }
          }}
        >
          <Icon size={14} /> {label}
        </button>
      ))}
    </>
  )
}

// Inline version (Open-Names list): a small button that reveals the four kinds.
export default function CreateCardMenu({ name }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className="create-card-wrap" ref={wrapRef}>
      <button
        type="button"
        className="names-chip create-card-btn"
        title={`Karte für »${name}« anlegen`}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus size={13} /> Karte anlegen
      </button>
      {open && (
        <span className="create-card-menu">
          <KindButtons name={name} onDone={() => setOpen(false)} />
        </span>
      )}
    </span>
  )
}

// Floating version (editor preview): anchored to the clicked #reference, in a
// portal so no scroll container can clip it.
const POP_GAP = 6
export function CreateCardPopover({ name, anchor, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const below = anchor.bottom + POP_GAP
    const top = below + h > vh - POP_GAP ? Math.max(POP_GAP, anchor.top - POP_GAP - h) : below
    setPos({ top, left: Math.max(POP_GAP, Math.min(anchor.left, vw - w - POP_GAP)) })
  }, [anchor.top, anchor.bottom, anchor.left])

  useEffect(() => {
    const onDoc = (e) => {
      if (!ref.current?.contains(e.target)) onClose?.()
    }
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      className="create-card-pop"
      style={pos ? { top: pos.top, left: pos.left } : { top: anchor.bottom + POP_GAP, left: anchor.left, visibility: 'hidden' }}
    >
      <div className="create-card-pop-head">
        Karte anlegen für <b>»{name}«</b>
      </div>
      <div className="create-card-pop-opts">
        <KindButtons name={name} onDone={onClose} />
      </div>
    </div>,
    document.body,
  )
}
