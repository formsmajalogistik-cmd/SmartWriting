import { useEffect, useState } from 'react'
import { User, MapPin, ArrowRight } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { ROLE_LABELS } from '../data/types.js'
import { deriveCharacterStatus } from '../lib/characterStatus.js'

// Compact preview of a character or place card, shown when hovering/tapping a
// resolved #link. Character: PRIMARY portrait + key details incl. Geschlecht
// and the derived per-book status. Place: short description.
export default function CardPreview({ kind, card, onOpen }) {
  const { getPortraitUrl, activeProject, activeBookId } = useStore()
  const [url, setUrl] = useState(null)
  const portraitPath = kind === 'character' ? card.card?.portrait_path : null

  useEffect(() => {
    let cancelled = false
    let objectUrl = null
    if (!portraitPath) {
      setUrl(null)
      return
    }
    getPortraitUrl(portraitPath)
      .then((u) => {
        if (cancelled) return
        if (u && u.startsWith('blob:')) objectUrl = u
        setUrl(u)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [portraitPath, getPortraitUrl])

  const derived =
    kind === 'character'
      ? deriveCharacterStatus(card, activeProject?.settings?.books ?? [], activeBookId)
      : ''
  const details =
    kind === 'character'
      ? [ROLE_LABELS[card.role] || card.role, card.card?.sex, card.card?.species, card.card?.age, derived]
          .filter(Boolean)
          .join(' · ')
      : [card.place_type, card.region].filter(Boolean).join(' · ')
  const desc = kind === 'place' ? card.card?.description : card.card?.who

  return (
    <div className="card-preview">
      <div className="card-preview-head">
        {kind === 'character' && (
          <div className="card-preview-portrait">
            {url ? <img src={url} alt="" /> : <User size={26} className="portrait-glyph" />}
          </div>
        )}
        <div className="card-preview-title">
          <span className="card-preview-kind">
            {kind === 'character' ? <User size={12} /> : <MapPin size={12} />}
            {kind === 'character' ? 'Figur' : 'Ort'}
          </span>
          <strong>
            {card.name}
            {!card.name_final && <span className="badge provisional small">prov.</span>}
          </strong>
          {details && <span className="card-preview-sub">{details}</span>}
        </div>
      </div>
      {desc && <p className="card-preview-desc">{desc}</p>}
      <button className="toggle primary card-preview-open" onClick={onOpen}>
        Karte öffnen <ArrowRight size={14} />
      </button>
    </div>
  )
}
