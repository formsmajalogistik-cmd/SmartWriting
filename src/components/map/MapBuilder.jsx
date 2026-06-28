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
} from 'lucide-react'
import { useStore } from '../../state/store.jsx'
import TerrainScene from './TerrainScene.jsx'
import {
  DEFAULT_SETTINGS,
  PAINT_TYPES,
  cellsInBrush,
  clampHeight,
  decodeHeights,
  encodeHeights,
  floodFillRegion,
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
  const { saveTerrain } = useStore()
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
  const [mode, setMode] = useState('navigate') // 'navigate' | 'edit'
  const [tool, setTool] = useState('raise') // raise | lower | flatten | brush | fill
  const [paintType, setPaintType] = useState('grass') // selected palette colour key
  const [brushSize, setBrushSize] = useState(2)
  const [flattenTarget, setFlattenTarget] = useState(4)
  const [seaLevel, setSeaLevel] = useState(terrain.sea_level ?? 2)
  const [structRev, setStructRev] = useState(0) // bump → scene full rebuild
  const [saveState, setSaveState] = useState('saved') // saved|dirty|saving|error
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [resetSignal, setResetSignal] = useState(0) // bump → camera back to default view
  const [heading, setHeading] = useState(0) // camera azimuth (rad) → compass

  // Throttle compass updates so orbiting doesn't re-render on every frame.
  const headingRef = useRef(0)
  const onHeading = useCallback((az) => {
    if (Math.abs(az - headingRef.current) < 0.01) return
    headingRef.current = az
    setHeading(az)
  }, [])
  const resetView = useCallback(() => setResetSignal((r) => r + 1), [])

  const toolRef = useRef(tool)
  const paintTypeRef = useRef(paintType)
  const brushRef = useRef(brushSize)
  const targetRef = useRef(flattenTarget)
  const seaLevelRef = useRef(seaLevel)
  toolRef.current = tool
  paintTypeRef.current = paintType
  brushRef.current = brushSize
  targetRef.current = flattenTarget
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
      settings,
    }),
    [widthN, heightN, settings],
  )

  const doSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (savingRef.current) return
    savingRef.current = true
    setSaveState('saving')
    try {
      await saveTerrain(buildPayload())
      dirtyRef.current = false
      setSaveState((s) => (dirtyRef.current ? 'dirty' : 'saved'))
    } catch {
      setSaveState('error') // also surfaced by the global error banner
    } finally {
      savingRef.current = false
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
        />
        {/* Compass: rotates with the camera heading so North is always obvious;
            click it to snap the view back to the default (looking North). */}
        <button
          className="map-compass"
          onClick={resetView}
          title="Norden — Ansicht zurücksetzen"
          aria-label="Kompass: Ansicht nach Norden zurücksetzen"
          style={{ '--compass-rot': `${(heading * 180) / Math.PI}deg` }}
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
            paint; the eraser clears a cell back to its height-based auto-colour. */}
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
      </div>
    </div>
  )
}
