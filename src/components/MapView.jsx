import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Loader2, AlertTriangle, Mountain } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import {
  SIZE_PRESETS,
  DEFAULT_SETTINGS,
  DEFAULT_SEA_LEVEL,
  createHeights,
  encodeHeights,
} from '../lib/terrain/model.js'

// The entire 3D builder (react-three-fiber + drei + three.js) lives behind this
// lazy import, so Three.js is only fetched the first time the map view is
// opened — exactly the same on-demand strategy as the PDF library.
const MapBuilder = lazy(() => import('./map/MapBuilder.jsx'))

// MapView is the eager, Three-free gate: it loads the project's terrain, offers
// creation (size presets) when none exists, and only then mounts the heavy
// builder. Loading / error / empty states are explicit — no silent failures.
export default function MapView() {
  const { activeProjectId, loadTerrain, createTerrain } = useStore()
  const [status, setStatus] = useState('loading') // loading | error | none | ready
  const [terrain, setTerrain] = useState(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const t = await loadTerrain(activeProjectId)
      setTerrain(t)
      setStatus(t ? 'ready' : 'none')
    } catch {
      setStatus('error') // message also surfaced via the global error banner
    }
  }, [activeProjectId, loadTerrain])

  useEffect(() => {
    load()
  }, [load])

  async function handleCreate(preset) {
    if (creating) return
    setCreating(true)
    try {
      // Start flat at height 0: with sea level above it the whole grid begins
      // as open ocean, and the author raises cells to sculpt land.
      const heights = createHeights(preset.width, preset.height, 0)
      const t = await createTerrain({
        width: preset.width,
        height: preset.height,
        sea_level: DEFAULT_SEA_LEVEL,
        heights: encodeHeights(heights),
        terrain_types: null,
        settings: { ...DEFAULT_SETTINGS },
      })
      setTerrain(t)
      setStatus('ready')
    } catch {
      // surfaced by the global error banner
    } finally {
      setCreating(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="map-state">
        <Loader2 className="spin" size={22} /> Karte wird geladen …
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="map-state">
        <AlertTriangle size={22} />
        <p>Die Karte konnte nicht geladen werden.</p>
        <button className="toggle primary" onClick={load}>
          Erneut versuchen
        </button>
      </div>
    )
  }

  if (status === 'none') {
    return (
      <div className="map-create">
        <Mountain size={28} />
        <h2>Terrain anlegen</h2>
        <p>
          Wähle eine Rastergröße. Du formst die Welt anschließend selbst: Hebe Zellen über den
          Meeresspiegel, um Land und Küsten entstehen zu lassen. Die Größe ist später nicht mehr
          änderbar.
        </p>
        <div className="preset-grid">
          {SIZE_PRESETS.map((p) => (
            <button
              key={p.key}
              className="preset-card"
              disabled={creating}
              onClick={() => handleCreate(p)}
            >
              <span className="preset-label">{p.label}</span>
              <span className="preset-dim">
                {p.width} × {p.height}
              </span>
              {p.heavy && <span className="preset-note">leistungsintensiver</span>}
            </button>
          ))}
        </div>
        {creating && (
          <p className="map-substate">
            <Loader2 className="spin" size={15} /> Terrain wird erstellt …
          </p>
        )}
      </div>
    )
  }

  // status === 'ready'
  return (
    <Suspense
      fallback={
        <div className="map-state">
          <Loader2 className="spin" size={22} /> 3D-Editor wird geladen …
        </div>
      }
    >
      <MapBuilder key={terrain.id} terrain={terrain} />
    </Suspense>
  )
}
