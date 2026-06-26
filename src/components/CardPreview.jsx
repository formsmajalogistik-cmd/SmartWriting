import { useEffect, useState } from 'react'
import { useStore } from '../state/store.jsx'

// Compact preview of a character or place card, shown when hovering/tapping a
// resolved #link. Character: portrait + key details. Place: short description.
export default function CardPreview({ kind, card, onOpen }) {
  const { getPortraitUrl } = useStore()
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

  const details =
    kind === 'character'
      ? [card.role, card.card?.species, card.card?.age].filter(Boolean).join(' · ')
      : [card.place_type, card.region].filter(Boolean).join(' · ')
  const desc = kind === 'place' ? card.card?.description : card.card?.who

  return (
    <div className="card-preview">
      <div className="card-preview-head">
        {kind === 'character' && (
          <div className="card-preview-portrait">
            {url ? <img src={url} alt="" /> : <span className="portrait-glyph">👤</span>}
          </div>
        )}
        <div className="card-preview-title">
          <span className="card-preview-kind">{kind === 'character' ? '👤 Figur' : '📍 Ort'}</span>
          <strong>
            {card.name}
            {!card.name_final && <span className="badge provisional small">prov.</span>}
          </strong>
          {details && <span className="card-preview-sub">{details}</span>}
        </div>
      </div>
      {desc && <p className="card-preview-desc">{desc}</p>}
      <button className="toggle primary card-preview-open" onClick={onOpen}>
        Karte öffnen →
      </button>
    </div>
  )
}
