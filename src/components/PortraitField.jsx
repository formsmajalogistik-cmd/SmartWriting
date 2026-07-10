import { useEffect, useMemo, useRef, useState } from 'react'
import { User, AlertTriangle, Star, Trash2, Plus, X } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { downscaleImage } from '../lib/image.js'

// Image GALLERY for a character card (grew out of the single portrait).
// Multiple images live in the private bucket; the card jsonb stores the path
// list (`gallery`) plus the PRIMARY portrait (`portrait_path`) — the primary is
// what every other consumer (previews, autocomplete, timeline tokens, exports)
// already reads, so setting a new primary updates all of them automatically.
//
// Props:
//   characterId
//   path                 — primary portrait path ('' / null = none)
//   gallery              — array of storage paths (may be empty for old cards)
//   onChange(patch)      — persist { gallery, portrait_path } onto the card
export default function PortraitField({ characterId, path, gallery, onChange }) {
  const { uploadPortrait, getPortraitUrl, deletePortrait } = useStore()
  const [urls, setUrls] = useState({}) // path → viewable URL
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [viewPath, setViewPath] = useState(null) // lightbox
  const inputRef = useRef(null)

  // Old cards carry only portrait_path — treat it as a one-image gallery.
  const paths = useMemo(() => {
    const list = Array.isArray(gallery) && gallery.length ? [...gallery] : path ? [path] : []
    if (path && !list.includes(path)) list.unshift(path)
    return list
  }, [gallery, path])
  const primary = path && paths.includes(path) ? path : paths[0] || ''

  // Resolve viewable URLs for every gallery path.
  useEffect(() => {
    let cancelled = false
    const objectUrls = []
    ;(async () => {
      const next = {}
      for (const p of paths) {
        try {
          const u = await getPortraitUrl(p)
          if (u && u.startsWith('blob:')) objectUrls.push(u)
          next[p] = u
        } catch {
          next[p] = null
        }
      }
      if (!cancelled) setUrls(next)
    })()
    return () => {
      cancelled = true
      for (const u of objectUrls) URL.revokeObjectURL(u)
    }
  }, [paths.join('|'), getPortraitUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onPick(e) {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    if (!files.length) return
    setError(null)
    setUploading(true)
    try {
      const added = []
      for (const file of files) {
        if (!file.type?.startsWith('image/')) {
          setError('Bitte nur Bilddateien wählen (JPG, PNG oder WebP).')
          continue
        }
        const { blob, ext, contentType } = await downscaleImage(file, 800)
        added.push(await uploadPortrait(characterId, blob, { ext, contentType }))
      }
      if (added.length) {
        const nextGallery = [...paths, ...added]
        onChange({ gallery: nextGallery, portrait_path: primary || added[0] })
      }
    } catch (err) {
      setError(err?.message || 'Upload fehlgeschlagen.')
    } finally {
      setUploading(false)
    }
  }

  function setPrimary(p) {
    onChange({ gallery: paths, portrait_path: p })
  }

  async function removeImage(p) {
    setError(null)
    const nextGallery = paths.filter((x) => x !== p)
    const nextPrimary = p === primary ? nextGallery[0] || '' : primary
    onChange({ gallery: nextGallery, portrait_path: nextPrimary })
    if (viewPath === p) setViewPath(null)
    try {
      await deletePortrait(p)
    } catch (err) {
      setError(err?.message || 'Bild konnte nicht gelöscht werden.')
    }
  }

  return (
    <div className="portrait-field gallery">
      <div className="portrait-frame" title={primary ? 'Hauptbild' : ''}>
        {uploading ? (
          <div className="portrait-placeholder loading">
            <span className="spinner" /> Lädt hoch …
          </div>
        ) : primary && urls[primary] ? (
          <img
            className="portrait-img"
            src={urls[primary]}
            alt="Porträt (Hauptbild)"
            onClick={() => setViewPath(primary)}
          />
        ) : (
          <div className="portrait-placeholder">
            <User size={40} className="portrait-glyph" />
            <span>Kein Bild</span>
          </div>
        )}
      </div>

      {paths.length > 0 && (
        <div className="gallery-strip" role="list" aria-label="Bildergalerie">
          {paths.map((p) => (
            <div key={p} className={`gallery-thumb ${p === primary ? 'primary' : ''}`} role="listitem">
              {urls[p] ? (
                <img src={urls[p]} alt="" onClick={() => setViewPath(p)} title="Größer ansehen" />
              ) : (
                <span className="gallery-thumb-empty"><User size={16} /></span>
              )}
              <div className="gallery-thumb-actions">
                <button
                  type="button"
                  className={`icon-btn sm ${p === primary ? 'on' : ''}`}
                  title={p === primary ? 'Hauptbild' : 'Als Hauptbild verwenden'}
                  aria-label={p === primary ? 'Hauptbild' : 'Als Hauptbild verwenden'}
                  disabled={p === primary}
                  onClick={() => setPrimary(p)}
                >
                  <Star size={12} />
                </button>
                <button
                  type="button"
                  className="icon-btn sm danger"
                  title="Bild löschen"
                  aria-label="Bild löschen"
                  onClick={() => removeImage(p)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="portrait-actions">
        <button
          type="button"
          className="toggle"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          <Plus size={14} /> {paths.length ? 'Bilder hinzufügen' : 'Bild hochladen'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={onPick}
        />
      </div>

      {error && (
        <div className="portrait-error">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {viewPath && urls[viewPath] && (
        <div className="gallery-lightbox" onClick={() => setViewPath(null)} role="dialog" aria-label="Bildansicht">
          <img src={urls[viewPath]} alt="Bild in groß" onClick={(e) => e.stopPropagation()} />
          <div className="gallery-lightbox-bar" onClick={(e) => e.stopPropagation()}>
            {viewPath !== primary && (
              <button type="button" className="toggle" onClick={() => { setPrimary(viewPath); }}>
                <Star size={14} /> Als Hauptbild
              </button>
            )}
            <button type="button" className="toggle danger-text" onClick={() => removeImage(viewPath)}>
              <Trash2 size={14} /> Löschen
            </button>
            <button type="button" className="toggle" onClick={() => setViewPath(null)}>
              <X size={14} /> Schließen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
