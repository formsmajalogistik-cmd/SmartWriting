import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Move,
  Mountain,
  ArrowUp,
  ArrowDown,
  Minus,
  Undo2,
  Redo2,
  Save,
  Loader2,
  Waves,
  Check,
  AlertTriangle,
  Eraser,
  Compass,
  PaintBucket,
  Navigation,
  MapPin,
  X,
  Triangle,
  History,
  ChevronLeft,
  ChevronRight,
  CalendarClock,
  MapPinOff,
} from 'lucide-react'
import { useStore } from '../../state/store.jsx'
import TerrainScene from './TerrainScene.jsx'
import {
  orderedChapters,
  placementsForChapterIndex,
  eventsForChapter,
} from '../../lib/timeline/timeline.js'
import {
  DEFAULT_SETTINGS,
  PAINT_TYPES,
  NORTH_PRESETS,
  normalizeDeg,
  cellsInBrush,
  clampHeight,
  decodeHeights,
  encodeHeights,
  floodFillRegion,
  mountainDelta,
  idx,
} from '../../lib/terrain/model.js'

const AUTOSAVE_MS = 1000

// `tool` is the active editing tool; `paintType` (a separate selection) is the
// colour the paint tools apply. Paint tools ('brush', 'fill') write the per-cell
// terrain-type override layer; the others sculpt the height layer.
//   paint key -> type id; 'erase' -> 0 (back to the height-based auto-colour).
const PAINT_VALUE = { erase: 0, ...Object.fromEntries(PAINT_TYPES.map((t) => [t.key, t.id])) }
const isPaintTool = (tool) => tool === 'brush' || tool === 'fill'

// The terrain sculptor. Owns the mutable heights buffer, the undo/redo history,
// and autosave. The 3D scene is purely presentational + input; all edit logic
// lives here so it stays testable and the scene never re-renders mid-stroke.
export default function MapBuilder({ terrain }) {
  const {
    saveTerrain,
    places,
    updatePlace,
    openCard,
    chapters,
    characters,
    locations,
    events,
    activeProject,
    getPortraitUrl,
  } = useStore()
  const widthN = terrain.width
  const heightN = terrain.height
  const settings = useMemo(() => ({ ...DEFAULT_SETTINGS, ...(terrain.settings || {}) }), [terrain])
  const maxHeight = settings.maxHeight

  // Mutable buffers (decoded once; component is keyed by terrain.id upstream).
  const heightsRef = useRef(null)
  if (!heightsRef.current) heightsRef.current = decodeHeights(terrain.heights, widthN * heightN)
  const typesRef = useRef(undefined)
  if (typesRef.current === undefined) {
    typesRef.current = terrain.terrain_types
      ? decodeHeights(terrain.terrain_types, widthN * heightN)
      : null // clean seam: no manual terrain-type data yet → auto-colour only
  }

  // --- UI state (mirrors are kept in refs for the stable paint callback) ---
  // Three hard-separated contexts so camera / terrain-sculpt / marker editing
  // never interfere: 'navigate' (camera only) | 'edit' (Stage A terrain tools) |
  // 'markers' (place / move / remove location markers).
  const [mode, setModeRaw] = useState('navigate')
  const [pendingPlaceId, setPendingPlaceId] = useState(null) // place awaiting a click-to-drop
  const [markerMsg, setMarkerMsg] = useState(null) // marker save/error notice
  const [chapterIndex, setChapterIndex] = useState(0) // timeline scrubber position
  const [tool, setTool] = useState('raise') // raise | lower | flatten | brush | fill
  const [paintType, setPaintType] = useState('grass') // selected palette colour key
  const [brushSize, setBrushSize] = useState(2)
  const [flattenTarget, setFlattenTarget] = useState(4)
  const [mountainHeight, setMountainHeight] = useState(6) // peak height (steps) for the Berg tool
  const [seaLevel, setSeaLevel] = useState(terrain.sea_level ?? 2)
  const [structRev, setStructRev] = useState(0) // bump → scene full rebuild
  const [saveState, setSaveState] = useState('saved') // saved|dirty|saving|error
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [resetSignal, setResetSignal] = useState(0) // bump → camera back to default view
  const [heading, setHeading] = useState(0) // camera azimuth (rad) → compass
  const [northOffset, setNorthOffset] = useState(() => normalizeDeg(settings.north_offset)) // chosen North, degrees
  const northOffsetRef = useRef(northOffset)
  northOffsetRef.current = northOffset

  // Throttle compass updates so orbiting doesn't re-render on every frame.
  const headingRef = useRef(0)
  const onHeading = useCallback((az) => {
    if (Math.abs(az - headingRef.current) < 0.01) return
    headingRef.current = az
    setHeading(az)
  }, [])
  const resetView = useCallback(() => setResetSignal((r) => r + 1), [])

  // Set the chosen North (degrees). Rotates the cardinal markers + compass live;
  // the camera is NOT yanked (reset/reopen aligns). Persistence is handled by an
  // effect below so it doesn't depend on markDirty being defined yet.
  const setNorth = useCallback((deg) => setNorthOffset(normalizeDeg(deg)), [])

  // Switch top-level mode. Leaving markers mode cancels any pending placement so
  // a stray terrain click in navigate/edit can never drop a marker.
  const setMode = useCallback((m) => {
    setModeRaw(m)
    if (m !== 'markers') setPendingPlaceId(null)
  }, [])

  // --- markers ------------------------------------------------------------
  // Markers ARE this project's place cards: a place with grid coords is on the
  // map, one without isn't. Positions are stored on the place row's `coords`
  // jsonb ({col,row}); the place card itself is otherwise untouched.
  const placedMarkers = useMemo(
    () =>
      places
        .filter((p) => p.coords && Number.isFinite(p.coords.col) && Number.isFinite(p.coords.row))
        .map((p) => ({
          placeId: p.id,
          col: p.coords.col,
          row: p.coords.row,
          name: p.name,
          name_final: p.name_final,
        })),
    [places],
  )
  const unplacedPlaces = useMemo(
    () => places.filter((p) => !(p.coords && Number.isFinite(p.coords.col) && Number.isFinite(p.coords.row))),
    [places],
  )

  // Drop a pending place onto a clicked cell (persists coords). Clears the
  // pending selection so the next pick starts clean.
  const placeMarker = useCallback(
    async (placeId, cell) => {
      setMarkerMsg(null)
      try {
        await updatePlace(placeId, { coords: { col: cell.col, row: cell.row } })
        setPendingPlaceId((cur) => (cur === placeId ? null : cur))
      } catch {
        setMarkerMsg('Marker konnte nicht gespeichert werden.')
      }
    },
    [updatePlace],
  )
  // Move an existing marker to a new cell (drag commit).
  const moveMarker = useCallback(
    async (placeId, cell) => {
      setMarkerMsg(null)
      try {
        await updatePlace(placeId, { coords: { col: cell.col, row: cell.row } })
      } catch {
        setMarkerMsg('Position konnte nicht gespeichert werden.')
      }
    },
    [updatePlace],
  )
  // Remove a marker from the map: clears coords only — the place card stays.
  const removeMarker = useCallback(
    async (placeId) => {
      setMarkerMsg(null)
      try {
        await updatePlace(placeId, { coords: null })
      } catch {
        setMarkerMsg('Marker konnte nicht entfernt werden.')
      }
    },
    [updatePlace],
  )
  // Tap a marker → open its place card (reuses the existing place card view).
  const openMarker = useCallback((placeId) => openCard('place', placeId), [openCard])

  // --- timeline ------------------------------------------------------------
  // Chapters in book → chapter reading order, and the clamped scrubber index.
  const books = activeProject?.settings?.books ?? []
  const orderedChs = useMemo(() => orderedChapters(chapters, books), [chapters, books])
  const chapterCount = orderedChs.length
  const chIdx = Math.min(chapterIndex, Math.max(0, chapterCount - 1))
  const selectedChapter = orderedChs[chIdx] || null

  // Per-chapter scene data: character tokens at their (carried-forward) place,
  // an off-map list for placements whose place has no coords, and the events
  // linked to this chapter (with on-map indicators where the place is placed).
  const placeById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places])
  const charById = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters])

  const timeline = useMemo(() => {
    if (!selectedChapter) return { tokens: [], offMap: [], chapterEvents: [], eventPlaces: [] }
    const placements = placementsForChapterIndex(
      locations,
      orderedChs.map((c) => c.id),
      chIdx,
    )
    const onByPlace = new Map() // placeId → tokens (for clustering)
    const offMap = []
    for (const [characterId, placeId] of placements) {
      const ch = charById.get(characterId)
      if (!ch) continue // character deleted; skip
      const place = placeById.get(placeId)
      const coords = place?.coords
      const base = {
        characterId,
        name: ch.name,
        name_final: ch.name_final,
        portrait_path: ch.card?.portrait_path || null,
      }
      if (place && coords && Number.isFinite(coords.col) && Number.isFinite(coords.row)) {
        const arr = onByPlace.get(placeId) || []
        arr.push({ ...base, col: coords.col, row: coords.row })
        onByPlace.set(placeId, arr)
      } else {
        offMap.push({ ...base, placeName: place?.name || '(unbekannter Ort)' })
      }
    }
    const tokens = []
    for (const arr of onByPlace.values()) {
      arr.forEach((t, i) => tokens.push({ ...t, clusterIndex: i, clusterCount: arr.length }))
    }
    // Events linked to this chapter; group placed ones for an on-map indicator.
    const chapterEvents = eventsForChapter(events, selectedChapter.id)
    const evByPlace = new Map()
    for (const ev of chapterEvents) {
      const place = ev.place_id ? placeById.get(ev.place_id) : null
      const coords = place?.coords
      if (place && coords && Number.isFinite(coords.col) && Number.isFinite(coords.row)) {
        const cur = evByPlace.get(place.id) || { placeId: place.id, col: coords.col, row: coords.row, count: 0 }
        cur.count += 1
        evByPlace.set(place.id, cur)
      }
    }
    return { tokens, offMap, chapterEvents, eventPlaces: [...evByPlace.values()] }
  }, [selectedChapter, locations, orderedChs, chIdx, charById, placeById, events])

  const chapterLabel = useMemo(() => {
    if (!selectedChapter) return ''
    const bt = books.find((b) => b.id === selectedChapter.book)?.title
    const num = selectedChapter.number != null ? `${selectedChapter.number}. ` : ''
    return `${bt ? `${bt} · ` : ''}${num}${selectedChapter.title || 'Kapitel'}`
  }, [selectedChapter, books])

  const openCharacter = useCallback((id) => openCard('character', id), [openCard])
  const stepChapter = useCallback(
    (delta) => setChapterIndex((i) => Math.max(0, Math.min(chapterCount - 1, i + delta))),
    [chapterCount],
  )

  const toolRef = useRef(tool)
  const paintTypeRef = useRef(paintType)
  const brushRef = useRef(brushSize)
  const targetRef = useRef(flattenTarget)
  const mountainRef = useRef(mountainHeight)
  const seaLevelRef = useRef(seaLevel)
  toolRef.current = tool
  paintTypeRef.current = paintType
  brushRef.current = brushSize
  targetRef.current = flattenTarget
  mountainRef.current = mountainHeight
  seaLevelRef.current = seaLevel

  // --- history + autosave plumbing ---
  const undoRef = useRef([])
  const redoRef = useRef([])
  const strokeRef = useRef(null)
  const dirtyRef = useRef(false)
  const saveTimerRef = useRef(null)
  const savingRef = useRef(false)

  const buildPayload = useCallback(
    () => ({
      width: widthN,
      height: heightN,
      sea_level: seaLevelRef.current,
      heights: encodeHeights(heightsRef.current),
      terrain_types: typesRef.current ? encodeHeights(typesRef.current) : null,
      // Persist the chosen North into the settings jsonb (no new column needed).
      settings: { ...settings, north_offset: northOffsetRef.current },
    }),
    [widthN, heightN, settings],
  )

  const doSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (savingRef.current) return // a save is running; its finally re-schedules
    savingRef.current = true
    // Capture: we're about to persist the CURRENT state. If markDirty fires
    // during the await it sets dirtyRef true again, and the finally below saves
    // once more — so the latest value (e.g. a fresh North) is never dropped.
    dirtyRef.current = false
    setSaveState('saving')
    try {
      await saveTerrain(buildPayload())
      setSaveState(dirtyRef.current ? 'dirty' : 'saved')
    } catch {
      dirtyRef.current = true // failed → still unsaved
      setSaveState('error') // also surfaced by the global error banner
    } finally {
      savingRef.current = false
      if (dirtyRef.current) {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(doSave, AUTOSAVE_MS)
      }
    }
  }, [saveTerrain, buildPayload])

  const markDirty = useCallback(() => {
    dirtyRef.current = true
    setSaveState('dirty')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(doSave, AUTOSAVE_MS)
  }, [doSave])

  // Allocate the per-cell terrain-type layer lazily — only once the author
  // actually paints a type, so terrains with no paint stay null (auto-only).
  const ensureTypes = useCallback(() => {
    if (!typesRef.current) typesRef.current = new Uint8Array(widthN * heightN)
    return typesRef.current
  }, [widthN, heightN])

  // --- brush ops (stable identity; read live settings from refs) ---
  // A stroke targets ONE layer (heights or terrain-types), fixed at pointer-down
  // from the active tool, so undo can restore the right buffer.
  const beginStroke = useCallback(() => {
    const layer = toolRef.current === 'brush' ? 'type' : 'height'
    strokeRef.current = { layer, map: new Map() }
  }, [])

  const paintCell = useCallback(
    (cx, cy) => {
      const stroke = strokeRef.current
      if (!stroke) return []
      const tool = toolRef.current

      // Mountain: stamp a radial peak (centre-tall, tapering to the rim) in a
      // single action. Builds UP from the existing ground via max(), so a
      // click-drag merges overlapping stamps into a ridge instead of stair-
      // stepping, and the whole stamp/stroke stays one undo step. A touch of
      // slope jitter avoids a too-geometric look; the centre keeps full height.
      if (tool === 'mountain') {
        const heights = heightsRef.current
        const size = brushRef.current
        const r = Math.max(1, size - 1)
        const peak = mountainRef.current
        const baseH = heights[idx(cx, cy, widthN)]
        const out = []
        for (const i of cellsInBrush(cx, cy, size, widthN, heightN)) {
          const x = i % widthN
          const y = (i / widthN) | 0
          const d = Math.hypot(x - cx, y - cy)
          let add = mountainDelta(d, r, peak)
          if (d > 0) add *= 0.85 + 0.3 * Math.random()
          const target = clampHeight(baseH + Math.round(add), maxHeight)
          if (!stroke.map.has(i)) stroke.map.set(i, heights[i])
          const after = Math.max(heights[i], target)
          if (after !== heights[i]) {
            heights[i] = after
            out.push(i)
          }
        }
        return out
      }

      const cells = cellsInBrush(cx, cy, brushRef.current, widthN, heightN)
      const changed = []
      if (stroke.layer === 'type') {
        // Paint a terrain-type override (colour only, never elevation). No
        // height/sea checks → any type can be painted on ANY cell, including
        // water (e.g. Structure across water for a bridge).
        const types = ensureTypes()
        const value = PAINT_VALUE[paintTypeRef.current] // type id, or 0 for the eraser
        for (const i of cells) {
          if (stroke.map.has(i)) continue
          const before = types[i]
          stroke.map.set(i, before)
          if (value !== before) {
            types[i] = value
            changed.push(i)
          }
        }
        return changed
      }
      const heights = heightsRef.current
      for (const i of cells) {
        if (stroke.map.has(i)) continue // one step per cell per stroke (predictable)
        const before = heights[i]
        let after = before
        if (tool === 'raise') after = clampHeight(before + 1, maxHeight)
        else if (tool === 'lower') after = clampHeight(before - 1, maxHeight)
        else if (tool === 'flatten') after = clampHeight(targetRef.current, maxHeight)
        stroke.map.set(i, before)
        if (after !== before) {
          heights[i] = after
          changed.push(i)
        }
      }
      return changed
    },
    [widthN, heightN, maxHeight, ensureTypes],
  )

  const endStroke = useCallback(() => {
    const stroke = strokeRef.current
    strokeRef.current = null
    if (!stroke || !stroke.map.size) return
    const buf = stroke.layer === 'type' ? ensureTypes() : heightsRef.current
    const entries = []
    for (const [i, before] of stroke.map) {
      const after = buf[i]
      if (after !== before) entries.push({ i, before, after })
    }
    if (!entries.length) return
    undoRef.current.push({ layer: stroke.layer, entries })
    redoRef.current = []
    setCanUndo(true)
    setCanRedo(false)
    markDirty()
  }, [markDirty, ensureTypes])

  // Bucket fill: flood the contiguous region matching the clicked cell's kind
  // (its painted type, or its height-band if unpainted) and set it ALL to the
  // selected paint, as ONE undo step + one batched buffer update. Returns the
  // indices that actually changed (for the scene to recolour).
  const fillCell = useCallback(
    (cx, cy) => {
      const types = ensureTypes()
      const region = floodFillRegion({
        heights: heightsRef.current,
        types,
        width: widthN,
        height: heightN,
        seaLevel: seaLevelRef.current,
        maxHeight,
        sx: cx,
        sy: cy,
      })
      const value = PAINT_VALUE[paintTypeRef.current]
      const entries = []
      for (const i of region) {
        const before = types[i]
        if (before !== value) {
          entries.push({ i, before, after: value })
          types[i] = value
        }
      }
      if (!entries.length) return []
      undoRef.current.push({ layer: 'type', entries })
      redoRef.current = []
      setCanUndo(true)
      setCanRedo(false)
      markDirty()
      return entries.map((e) => e.i)
    },
    [widthN, heightN, maxHeight, ensureTypes, markDirty],
  )

  const undo = useCallback(() => {
    const item = undoRef.current.pop()
    if (!item) return
    const buf = item.layer === 'type' ? ensureTypes() : heightsRef.current
    for (const { i, before } of item.entries) buf[i] = before
    redoRef.current.push(item)
    setCanUndo(undoRef.current.length > 0)
    setCanRedo(true)
    setStructRev((r) => r + 1) // full rebuild recolours from heights + types
    markDirty()
  }, [markDirty, ensureTypes])

  const redo = useCallback(() => {
    const item = redoRef.current.pop()
    if (!item) return
    const buf = item.layer === 'type' ? ensureTypes() : heightsRef.current
    for (const { i, after } of item.entries) buf[i] = after
    undoRef.current.push(item)
    setCanRedo(redoRef.current.length > 0)
    setCanUndo(true)
    setStructRev((r) => r + 1)
    markDirty()
  }, [markDirty, ensureTypes])

  function changeSeaLevel(v) {
    setSeaLevel(v)
    seaLevelRef.current = v
    // Full rebuild: recolours every cell AND repositions structure-on-water
    // cells, whose waterline lift depends on the sea level.
    setStructRev((r) => r + 1)
    markDirty()
  }

  // Pick a paint colour from the palette (or the eraser). Switches to Edit mode;
  // keeps Fill active if it was (so you can fill several colours), else brush.
  function selectPaint(key) {
    setPaintType(key)
    setTool((cur) => (cur === 'fill' ? 'fill' : 'brush'))
    setMode('edit')
  }

  // Autosave a North change (skip the initial mount so just opening the map
  // doesn't mark it dirty).
  const northMountRef = useRef(true)
  useEffect(() => {
    if (northMountRef.current) {
      northMountRef.current = false
      return
    }
    markDirty()
  }, [northOffset, markDirty])

  // Keyboard: undo / redo while sculpting.
  useEffect(() => {
    function onKey(e) {
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // Flush a pending save on unmount / view switch so edits are never lost.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (dirtyRef.current && !savingRef.current) {
        // Best-effort final save (not awaited).
        saveTerrain(buildPayload()).catch(() => {})
      }
    }
  }, [saveTerrain, buildPayload])

  const saveLabel = {
    saved: 'gespeichert',
    dirty: 'ungespeichert',
    saving: 'speichert …',
    error: 'Fehler',
  }[saveState]

  return (
    <div className="map-builder">
      <div className="map-toolbar">
        {/* Mode: a hard separation so navigating never deforms terrain. */}
        <div className="seg" role="group" aria-label="Modus">
          <button
            className={`seg-btn ${mode === 'navigate' ? 'on' : ''}`}
            onClick={() => setMode('navigate')}
            title="Kamera bewegen (Orbit/Pan/Zoom)"
          >
            <Move size={15} /> Navigieren
          </button>
          <button
            className={`seg-btn ${mode === 'edit' ? 'on' : ''}`}
            onClick={() => setMode('edit')}
            title="Terrain formen"
          >
            <Mountain size={15} /> Bearbeiten
          </button>
          <button
            className={`seg-btn ${mode === 'markers' ? 'on' : ''}`}
            onClick={() => setMode('markers')}
            title="Marker setzen (Orte auf der Karte platzieren)"
          >
            <MapPin size={15} /> Marker
          </button>
          <button
            className={`seg-btn ${mode === 'timeline' ? 'on' : ''}`}
            onClick={() => setMode('timeline')}
            title="Zeitleiste: Figuren pro Kapitel auf der Karte verfolgen"
          >
            <History size={15} /> Zeitleiste
          </button>
        </div>

        <div className={`tool-group ${mode === 'edit' ? '' : 'disabled'}`}>
          <button
            className={`tool-btn ${tool === 'raise' ? 'on' : ''}`}
            onClick={() => setTool('raise')}
            disabled={mode !== 'edit'}
            title="Heben"
          >
            <ArrowUp size={15} /> Heben
          </button>
          <button
            className={`tool-btn ${tool === 'lower' ? 'on' : ''}`}
            onClick={() => setTool('lower')}
            disabled={mode !== 'edit'}
            title="Senken"
          >
            <ArrowDown size={15} /> Senken
          </button>
          <button
            className={`tool-btn ${tool === 'flatten' ? 'on' : ''}`}
            onClick={() => setTool('flatten')}
            disabled={mode !== 'edit'}
            title="Auf Höhe ebnen"
          >
            <Minus size={15} /> Ebnen
          </button>
          <button
            className={`tool-btn ${tool === 'fill' ? 'on' : ''}`}
            onClick={() => { setTool('fill'); setMode('edit') }}
            title="Füllen: zusammenhängenden Bereich mit der gewählten Farbe füllen"
          >
            <PaintBucket size={15} /> Füllen
          </button>
          <button
            className={`tool-btn ${tool === 'mountain' ? 'on' : ''}`}
            onClick={() => { setTool('mountain'); setMode('edit') }}
            title="Berg: mit einem Klick einen Gipfel aufschütten"
          >
            <Triangle size={15} /> Berg
          </button>
        </div>

        {/* Terrain-type paints live in the colour palette (canvas overlay). */}

        <label className="ctrl" title="Pinselgröße">
          <span>Pinsel</span>
          <input
            type="range"
            min="1"
            max="8"
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            disabled={mode !== 'edit'}
          />
          <span className="ctrl-val">{brushSize}</span>
        </label>

        {tool === 'flatten' && (
          <label className="ctrl" title="Zielhöhe zum Ebnen">
            <span>Höhe</span>
            <input
              type="range"
              min="0"
              max={maxHeight}
              value={flattenTarget}
              onChange={(e) => setFlattenTarget(Number(e.target.value))}
              disabled={mode !== 'edit'}
            />
            <span className="ctrl-val">{flattenTarget}</span>
          </label>
        )}

        {tool === 'mountain' && (
          <label className="ctrl" title="Gipfelhöhe (Schritte über dem Boden)">
            <Triangle size={13} />
            <span>Gipfel</span>
            <input
              type="range"
              min="1"
              max={maxHeight}
              value={mountainHeight}
              onChange={(e) => setMountainHeight(Number(e.target.value))}
              disabled={mode !== 'edit'}
            />
            <span className="ctrl-val">{mountainHeight}</span>
          </label>
        )}

        <label className="ctrl" title="Meeresspiegel">
          <Waves size={14} />
          <input
            type="range"
            min="0"
            max={maxHeight}
            value={seaLevel}
            onChange={(e) => changeSeaLevel(Number(e.target.value))}
          />
          <span className="ctrl-val">{seaLevel}</span>
        </label>

        {/* Set North: a dial (0–360°) + quick presets snapping North to an edge. */}
        <div className="ctrl north-ctrl" title="Norden festlegen">
          <Navigation size={14} />
          <span>Norden</span>
          <input
            type="range"
            min="0"
            max="359"
            value={northOffset}
            onChange={(e) => setNorth(Number(e.target.value))}
            aria-label="Nordrichtung in Grad"
          />
          <span className="ctrl-val north-val">{northOffset}°</span>
          <span className="north-presets" role="group" aria-label="Norden auf Kante setzen">
            {NORTH_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`north-preset ${northOffset === p.deg ? 'on' : ''}`}
                onClick={() => setNorth(p.deg)}
                title={`Norden = Kante ${p.key}`}
              >
                {p.label}
              </button>
            ))}
          </span>
        </div>

        <div className="map-toolbar-spacer" />

        <button className="icon-btn" onClick={resetView} title="Ansicht zurücksetzen (Blick nach Norden)">
          <Compass size={16} />
        </button>
        <button className="icon-btn" onClick={undo} disabled={!canUndo} title="Rückgängig (Strg/Cmd+Z)">
          <Undo2 size={16} />
        </button>
        <button className="icon-btn" onClick={redo} disabled={!canRedo} title="Wiederholen (Strg/Cmd+Umschalt+Z)">
          <Redo2 size={16} />
        </button>

        <span className={`save-state ${saveState === 'saved' ? 'ok' : saveState === 'error' ? 'err' : 'pending'}`}>
          {saveState === 'saving' && <Loader2 size={13} className="spin" />}
          {saveState === 'saved' && <Check size={13} />}
          {saveState === 'error' && <AlertTriangle size={13} />}
          {saveLabel}
        </span>
        <button
          className="toggle primary"
          onClick={doSave}
          disabled={saveState === 'saving' || saveState === 'saved'}
          title="Jetzt speichern"
        >
          <Save size={15} /> Speichern
        </button>
      </div>

      <div className="map-canvas-wrap">
        {mode === 'edit' && (
          <div className="map-mode-hint" role="status">
            Bearbeiten — ziehe über das Raster, um zu modellieren oder zu malen. Zum Bewegen der
            Kamera auf „Navigieren“ wechseln.
          </div>
        )}
        {mode === 'markers' && (
          <div className="map-mode-hint" role="status">
            {pendingPlaceId
              ? 'Klicke auf eine Zelle, um den Ort dort zu platzieren.'
              : 'Marker — wähle links einen Ort und klicke aufs Raster. Marker ziehen = verschieben, antippen = Karte öffnen.'}
          </div>
        )}
        <TerrainScene
          widthN={widthN}
          heightN={heightN}
          settings={settings}
          seaLevel={seaLevel}
          heightsRef={heightsRef}
          typesRef={typesRef}
          mode={mode}
          tool={tool}
          beginStroke={beginStroke}
          paintCell={paintCell}
          endStroke={endStroke}
          fillCell={fillCell}
          structRev={structRev}
          resetSignal={resetSignal}
          onHeading={onHeading}
          northOffset={northOffset}
          northOffsetRef={northOffsetRef}
          markers={placedMarkers}
          pendingPlaceId={pendingPlaceId}
          onPlaceMarker={placeMarker}
          onMoveMarker={moveMarker}
          onOpenMarker={openMarker}
          tokens={mode === 'timeline' ? timeline.tokens : []}
          eventPlaces={mode === 'timeline' ? timeline.eventPlaces : []}
          getPortraitUrl={getPortraitUrl}
          onOpenCharacter={openCharacter}
        />
        {/* Compass: rotates with the camera heading so North is always obvious;
            click it to snap the view back to the default (looking North). */}
        <button
          className="map-compass"
          onClick={resetView}
          title="Norden — Ansicht zurücksetzen"
          aria-label="Kompass: Ansicht nach Norden zurücksetzen"
          style={{ '--compass-rot': `${(heading * 180) / Math.PI - northOffset}deg` }}
        >
          <span className="compass-rose">
            <span className="compass-pt n">N</span>
            <span className="compass-pt e">E</span>
            <span className="compass-pt s">S</span>
            <span className="compass-pt w">W</span>
            <span className="compass-needle" />
          </span>
        </button>
        {/* The legend IS the paint palette: each colour is a selectable override
            paint; the eraser clears a cell back to its height-based auto-colour.
            Hidden in marker / timeline modes, where their own panels take over. */}
        {mode !== 'markers' && mode !== 'timeline' && (
          <div className="map-palette" role="group" aria-label="Farbpalette zum Malen">
            {PAINT_TYPES.map((t) => (
              <button
                type="button"
                key={t.key}
                className={`palette-item ${isPaintTool(tool) && paintType === t.key ? 'on' : ''}`}
                onClick={() => selectPaint(t.key)}
                title={`${t.label} ${tool === 'fill' ? 'füllen' : 'malen'}`}
              >
                <span className="legend-swatch" style={{ background: t.color }} />
                {t.label}
              </button>
            ))}
            <button
              type="button"
              className={`palette-item ${isPaintTool(tool) && paintType === 'erase' ? 'on' : ''}`}
              onClick={() => selectPaint('erase')}
              title="Bemalung entfernen (zurück zur Höhenfarbe)"
            >
              <Eraser size={13} /> Radierer
            </button>
          </div>
        )}

        {/* Marker panel: pick an unplaced place to drop, manage placed markers. */}
        {mode === 'markers' && (
          <div className="marker-panel" aria-label="Marker">
            <div className="marker-panel-head">
              <MapPin size={14} /> Marker
            </div>
            {markerMsg && <div className="marker-msg err" role="alert">{markerMsg}</div>}

            <div className="marker-section-title">Nicht auf der Karte ({unplacedPlaces.length})</div>
            {places.length === 0 ? (
              <p className="hint marker-empty">Noch keine Orte. Lege zuerst eine Ort-Karte an.</p>
            ) : unplacedPlaces.length === 0 ? (
              <p className="hint marker-empty">Alle Orte sind platziert.</p>
            ) : (
              <ul className="marker-list">
                {unplacedPlaces.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={`marker-pick ${pendingPlaceId === p.id ? 'on' : ''}`}
                      onClick={() => setPendingPlaceId((cur) => (cur === p.id ? null : p.id))}
                      title={pendingPlaceId === p.id ? 'Klicke aufs Raster zum Platzieren' : 'Zum Platzieren wählen'}
                    >
                      <MapPin size={13} />
                      <span className={p.name_final ? '' : 'prov'}>{p.name || '(ohne Namen)'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {placedMarkers.length > 0 && (
              <>
                <div className="marker-section-title">Auf der Karte ({placedMarkers.length})</div>
                <ul className="marker-list">
                  {placedMarkers.map((m) => (
                    <li key={m.placeId}>
                      <button
                        type="button"
                        className="marker-pick placed"
                        onClick={() => openMarker(m.placeId)}
                        title="Ort-Karte öffnen"
                      >
                        <MapPin size={13} />
                        <span className={m.name_final ? '' : 'prov'}>{m.name || '(ohne Namen)'}</span>
                      </button>
                      <button
                        type="button"
                        className="marker-remove"
                        onClick={() => removeMarker(m.placeId)}
                        title="Vom Karte entfernen (Ort-Karte bleibt erhalten)"
                        aria-label={`${m.name || 'Ort'} von der Karte entfernen`}
                      >
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {/* Timeline: scrub through chapters; tokens reposition; events + off-map
            characters are listed alongside. Read-only — no editing here. */}
        {mode === 'timeline' && (
          <>
            <div className="timeline-bar" aria-label="Kapitel-Zeitleiste">
              {chapterCount === 0 ? (
                <span className="timeline-empty">Noch keine Kapitel in diesem Projekt.</span>
              ) : (
                <>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => stepChapter(-1)}
                    disabled={chIdx <= 0}
                    title="Vorheriges Kapitel"
                    aria-label="Vorheriges Kapitel"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <div className="timeline-track">
                    <input
                      type="range"
                      min="0"
                      max={chapterCount - 1}
                      value={chIdx}
                      onChange={(e) => setChapterIndex(Number(e.target.value))}
                      aria-label="Kapitel wählen"
                    />
                    <span className="timeline-label">
                      <span className="timeline-pos">{chIdx + 1}/{chapterCount}</span> {chapterLabel}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => stepChapter(1)}
                    disabled={chIdx >= chapterCount - 1}
                    title="Nächstes Kapitel"
                    aria-label="Nächstes Kapitel"
                  >
                    <ChevronRight size={16} />
                  </button>
                </>
              )}
            </div>

            {chapterCount > 0 && (
              <div className="timeline-panel" aria-label="Kapitel-Details">
                {timeline.chapterEvents.length > 0 && (
                  <div className="timeline-section">
                    <div className="timeline-section-title">
                      <CalendarClock size={13} /> Ereignisse ({timeline.chapterEvents.length})
                    </div>
                    <ul className="timeline-list">
                      {timeline.chapterEvents.map((ev) => (
                        <li key={ev.id}>
                          <button
                            type="button"
                            className="timeline-item"
                            onClick={() => openCard('event', ev.id)}
                            title="Ereignis-Karte öffnen"
                          >
                            {ev.title || '(ohne Titel)'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {timeline.offMap.length > 0 && (
                  <div className="timeline-section">
                    <div className="timeline-section-title warn">
                      <MapPinOff size={13} /> Nicht auf der Karte ({timeline.offMap.length})
                    </div>
                    <ul className="timeline-list">
                      {timeline.offMap.map((o) => (
                        <li key={o.characterId}>
                          <button
                            type="button"
                            className="timeline-item"
                            onClick={() => openCharacter(o.characterId)}
                            title="Figur-Karte öffnen"
                          >
                            <span className={o.name_final ? '' : 'prov'}>{o.name || '(ohne Namen)'}</span>
                            <span className="timeline-sub">@ {o.placeName}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {timeline.tokens.length === 0 && timeline.offMap.length === 0 && (
                  <p className="timeline-empty">Keine Figuren in diesem Kapitel platziert.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
