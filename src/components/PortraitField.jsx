import { useEffect, useRef, useState } from 'react'
import { User, AlertTriangle } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { downscaleImage } from '../lib/image.js'

// Portrait image for a character card. Uploads from device (downscaled +
// compressed first), previews via a signed/object URL, and supports replace /
// remove. Only the storage path is persisted (onChange); the bytes live in the
// private bucket. Loading and error states are explicit — no silent failures.
//
// Props:
//   characterId
//   path             — current storage path (or '' / null)
//   onChange(path)   — persist the new path (or null) onto the card
export default function PortraitField({ characterId, path, onChange }) {
  const { uploadPortrait, getPortraitUrl, deletePortrait } = useStore()
  const [url, setUrl] = useState(null)
  const [urlLoading, setUrlLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  // Resolve a viewable URL whenever the stored path changes.
  useEffect(() => {
    let cancelled = false
    let objectUrl = null
    if (!path) {
      setUrl(null)
      return
    }
    setUrlLoading(true)
    getPortraitUrl(path)
      .then((u) => {
        if (cancelled) return
        if (u && u.startsWith('blob:')) objectUrl = u
        setUrl(u)
      })
      .catch(() => !cancelled && setError('Bild konnte nicht geladen werden.'))
      .finally(() => !cancelled && setUrlLoading(false))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path, getPortraitUrl])

  async function onPick(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setError(null)
    if (!file.type?.startsWith('image/')) {
      setError('Bitte eine Bilddatei wählen (JPG, PNG oder WebP).')
      return
    }
    setUploading(true)
    const previous = path
    try {
      const { blob, ext, contentType } = await downscaleImage(file, 800)
      const newPath = await uploadPortrait(characterId, blob, { ext, contentType })
      onChange(newPath)
      // Best-effort cleanup of the replaced image.
      if (previous && previous !== newPath) {
        deletePortrait(previous).catch(() => {})
      }
    } catch (err) {
      setError(err?.message || 'Upload fehlgeschlagen.')
    } finally {
      setUploading(false)
    }
  }

  async function onRemove() {
    const previous = path
    setError(null)
    onChange(null)
    if (previous) {
      try {
        await deletePortrait(previous)
      } catch (err) {
        setError(err?.message || 'Bild konnte nicht entfernt werden.')
      }
    }
  }

  return (
    <div className="portrait-field">
      <div className="portrait-frame">
        {uploading || urlLoading ? (
          <div className="portrait-placeholder loading">
            <span className="spinner" /> {uploading ? 'Lädt hoch …' : 'Lädt …'}
          </div>
        ) : url ? (
          <img className="portrait-img" src={url} alt="Porträt" />
        ) : (
          <div className="portrait-placeholder">
            <User size={40} className="portrait-glyph" />
            <span>Kein Bild</span>
          </div>
        )}
      </div>

      <div className="portrait-actions">
        <button
          type="button"
          className="toggle"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {path ? 'Ersetzen' : 'Bild hochladen'}
        </button>
        {path && !uploading && (
          <button type="button" className="toggle danger-text" onClick={onRemove}>
            Entfernen
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={onPick}
        />
      </div>

      {error && (
        <div className="portrait-error">
          <AlertTriangle size={14} /> {error}
        </div>
      )}
    </div>
  )
}
