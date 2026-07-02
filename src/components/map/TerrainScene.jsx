import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import { MapPin, CalendarClock } from 'lucide-react'
import {
  cellToWorld,
  worldToCell,
  inBounds,
  colorForCell,
  markerWorldPos,
  MARKER_FLOAT,
  computeRegionCentroids,
  CARDINALS,
} from '../../lib/terrain/model.js'

// The 3D terrain: one InstancedMesh of stepped box columns (a single draw call)
// coloured by height band. Painting is imperative — pointer samples mutate the
// shared heights buffer (in MapBuilder) and we update only the touched
// instances — so a brush stroke never triggers a React re-render of the scene.
function Cells({
  widthN,
  heightN,
  settings,
  seaLevel,
  heightsRef,
  typesRef,
  mode,
  tool,
  beginStroke,
  paintCell,
  endStroke,
  fillCell,
  isFill,
  structRev,
  meshRef,
}) {
  const painting = useRef(false)
  const { invalidate, camera, gl, raycaster } = useThree()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const tmpColor = useMemo(() => new THREE.Color(), [])
  // Reused raycasting scratch objects for the edit pointer handler.
  const ndc = useMemo(() => new THREE.Vector2(), [])
  const editPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const hitPoint = useMemo(() => new THREE.Vector3(), [])

  const { step, cellSize, maxHeight } = settings
  const baseDepth = step * 2 // give even height-0 cells body + a clickable top
  const count = widthN * heightN

  // Write one instance's matrix + colour from the current heights buffer.
  const writeInstance = useCallback(
    (i) => {
      const mesh = meshRef.current
      if (!mesh) return
      const h = heightsRef.current[i]
      const type = typesRef.current ? typesRef.current[i] : 0
      const x = i % widthN
      const y = Math.floor(i / widthN)
      const { x: px, z: pz } = cellToWorld(x, y, widthN, heightN, cellSize)
      // Any painted override on a submerged cell rises to just above the
      // waterline, so the paint is actually visible (a structure bridge, a
      // coastal path, forest on the shore) instead of being hidden under the
      // translucent sea plane. Stored height is unchanged — this is visual only;
      // unpainted water cells (type 0) stay submerged and read as sea.
      let topY = h * step
      if (type > 0 && h <= seaLevel) topY = seaLevel * step + 0.1
      const colH = topY + baseDepth
      dummy.position.set(px, (topY - baseDepth) / 2, pz)
      dummy.scale.set(cellSize, colH, cellSize)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      tmpColor.set(colorForCell(h, seaLevel, maxHeight, type))
      mesh.setColorAt(i, tmpColor)
    },
    [widthN, heightN, cellSize, step, baseDepth, maxHeight, seaLevel, heightsRef, typesRef, dummy, tmpColor],
  )

  const flush = useCallback(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    invalidate()
  }, [invalidate])

  // Full rebuild (matrices + colours): initial mount, terrain (re)load,
  // undo/redo, and sea-level changes. writeInstance closes over seaLevel, so a
  // sea-level change recreates it and re-runs this effect — repositioning
  // structure-on-water cells and recolouring every band in one pass.
  useEffect(() => {
    for (let i = 0; i < count; i++) writeInstance(i)
    flush()
  }, [structRev, count, writeInstance, flush])

  const applyChanged = useCallback(
    (indices) => {
      if (!indices || !indices.length) return
      for (const i of indices) writeInstance(i)
      flush()
    },
    [writeInstance, flush],
  )

  // Expose the mesh so e2e / debugging can read per-instance colours.
  useEffect(() => {
    window.__terrainMesh = meshRef.current
    return () => {
      if (window.__terrainMesh === meshRef.current) delete window.__terrainMesh
    }
  }, [count])

  // Latest mode + edit callbacks, read by the (stable) DOM pointer handlers so
  // the listeners attach once and never go stale.
  const live = useRef(null)
  live.current = { mode, tool, isFill, beginStroke, paintCell, endStroke, fillCell, applyChanged }

  // --- editing input -------------------------------------------------------
  // We drive editing from RAW pointer events on the canvas (not R3F's
  // per-object hover raycast), with pointer capture for the whole drag:
  //   • A single click edits exactly one cell.
  //   • A drag edits EVERY cell it crosses — capture means no dropped moves on
  //     fast drags, and raycasting a FIXED horizontal plane (set at the start
  //     cell's height) means a freshly raised ridge can't occlude the cells
  //     ahead of the cursor (the old per-instance raycast stopped after a
  //     couple of cells once a tall column blocked the ray).
  //   • Only active in Edit mode; OrbitControls is disabled there, so camera
  //     and editing never fight over the same drag.
  useEffect(() => {
    const el = gl.domElement

    const aim = (e) => {
      const rect = el.getBoundingClientRect()
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
    }
    const cellOnPlane = () => {
      if (!raycaster.ray.intersectPlane(editPlane, hitPoint)) return null
      const c = worldToCell(hitPoint.x, hitPoint.z, widthN, heightN, cellSize)
      return inBounds(c.x, c.y, widthN, heightN) ? c : null
    }
    const cellOnMesh = () => {
      const mesh = meshRef.current
      if (!mesh) return null
      const hits = raycaster.intersectObject(mesh, false)
      if (!hits.length) return null
      const c = worldToCell(hits[0].point.x, hits[0].point.z, widthN, heightN, cellSize)
      return inBounds(c.x, c.y, widthN, heightN) ? c : null
    }

    const onDown = (e) => {
      // Painting is active in terrain-edit mode AND region-paint mode; both drive
      // the same stroke machinery (MapBuilder decides which layer is written).
      if ((live.current.mode !== 'edit' && live.current.mode !== 'regions') || e.button !== 0) return
      e.preventDefault()
      aim(e)
      const start = cellOnMesh()
      if (!start) return
      // Fill is a single click — flood the region, no drag/capture.
      if (live.current.isFill) {
        live.current.applyChanged(live.current.fillCell(start.x, start.y))
        return
      }
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* capture is best-effort */
      }
      painting.current = true
      // Pin the edit plane at the start cell's height for the rest of the stroke
      // (occlusion-free, no drift).
      const h0 = heightsRef.current[start.y * widthN + start.x]
      editPlane.constant = -(h0 * step)
      live.current.beginStroke()
      live.current.applyChanged(live.current.paintCell(start.x, start.y))
    }
    const onMove = (e) => {
      if (!painting.current) return
      aim(e)
      const c = cellOnPlane()
      if (c) live.current.applyChanged(live.current.paintCell(c.x, c.y))
    }
    const onUp = (e) => {
      if (!painting.current) return
      painting.current = false
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      live.current.endStroke()
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
  }, [gl, camera, raycaster, widthN, heightN, cellSize, step, ndc, editPlane, hitPoint, heightsRef])

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      {/* NO `vertexColors`: per-instance colour comes from InstancedMesh's
          instanceColor (USE_INSTANCING_COLOR), applied automatically. Setting
          vertexColors would define USE_COLOR and multiply by the geometry's
          (absent) per-vertex `color` attribute — i.e. by 0 — turning every cell
          black. */}
      <meshLambertMaterial flatShading />
    </instancedMesh>
  )
}

// Translucent sea surface. `raycast` is disabled so clicks pass THROUGH the
// water to raise a submerged seabed into an island.
function WaterPlane({ widthN, heightN, settings, seaLevel }) {
  const { step, cellSize } = settings
  const w = widthN * cellSize * 1.04
  const h = heightN * cellSize * 1.04
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position-y={seaLevel * step + 0.02}
      raycast={() => null}
    >
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial
        color="#2f6f9f"
        transparent
        opacity={0.5}
        roughness={0.3}
        metalness={0.1}
        depthWrite={false}
      />
    </mesh>
  )
}

// Fixed N/E/S/W markers anchored in WORLD space, so they always point at the
// true cardinal directions no matter how the camera orbits. The whole ring is
// rotated by the chosen North (`northRad`) around +Y — the terrain stays put,
// only the cardinal assignment turns. Rendered as DOM labels via drei <Html>.
function Cardinals({ widthN, heightN, settings, northRad }) {
  const { cellSize, step } = settings
  const halfX = (widthN * cellSize) / 2
  const halfZ = (heightN * cellSize) / 2
  const R = Math.max(halfX, halfZ) + cellSize * 3 // ring radius, just outside the grid
  const y = step * 3
  return (
    <group rotation-y={northRad}>
      {CARDINALS.map((c) => (
        <Html
          key={c.key}
          position={[c.dir[0] * R, y, c.dir[1] * R]}
          center
          zIndexRange={[5, 0]}
          className="cardinal-html"
        >
          <span className={`cardinal-label ${c.key === 'N' ? 'north' : ''}`}>{c.label}</span>
        </Html>
      ))}
    </group>
  )
}

// Location markers: lightweight DOM billboards (drei <Html>) pinned to a cell.
// Constant screen size → readable at any zoom. Behaviour is gated by `mode`:
//   • navigate / edit : a tap opens the place card; markers are NOT draggable
//                       (in edit mode they're click-through so painting works).
//   • markers         : tap opens the card, drag moves the marker (snapping to
//                       the cell under the cursor), and — with a place pending —
//                       a click on the terrain drops a new marker there.
// Positions are raycast against the terrain InstancedMesh (shared `meshRef`).
function Markers({
  meshRef,
  widthN,
  heightN,
  settings,
  heightsRef,
  mode,
  markers,
  pendingPlaceId,
  onPlaceMarker,
  onMoveMarker,
  onOpenMarker,
  structRev,
}) {
  const { camera, gl, raycaster, invalidate } = useThree()
  const controls = useThree((s) => s.controls)
  const ndc = useMemo(() => new THREE.Vector2(), [])
  const [dragId, setDragId] = useState(null)
  const [dragCell, setDragCell] = useState(null) // live {col,row} during a drag
  const dragCellRef = useRef(null)
  const movedRef = useRef(false)

  // --- dense-marker handling: labels appear only when zoomed in -------------
  // With many markers close together, always-on labels become a wall of text.
  // So a name-label shows only when the camera is close enough (past a zoom
  // threshold), or when that marker is hovered (mouse) / revealed by a first
  // tap (touch), or while editing markers. Below the threshold only the compact
  // pin shows, so a cluster stays readable and each pin remains clickable.
  const gridD = Math.max(widthN, heightN) * settings.cellSize
  const labelDist = gridD * 0.7 // show labels once nearer than this to the target
  const [zoomedIn, setZoomedIn] = useState(false)
  const [hoverId, setHoverId] = useState(null) // desktop hover (mouse only)
  const [revealId, setRevealId] = useState(null) // touch: first tap reveals
  const pointerKindRef = useRef('mouse')

  useEffect(() => {
    if (!controls) return
    const update = () => setZoomedIn(camera.position.distanceTo(controls.target) < labelDist)
    update()
    controls.addEventListener('change', update)
    return () => controls.removeEventListener('change', update)
  }, [controls, camera, labelDist])

  // Resolve the grid cell under a client point by raycasting the terrain mesh.
  const aimCell = useCallback(
    (clientX, clientY) => {
      const mesh = meshRef.current
      if (!mesh) return null
      const rect = gl.domElement.getBoundingClientRect()
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObject(mesh, false)
      if (!hits.length) return null
      const c = worldToCell(hits[0].point.x, hits[0].point.z, widthN, heightN, settings.cellSize)
      return inBounds(c.x, c.y, widthN, heightN) ? { col: c.x, row: c.y } : null
    },
    [meshRef, gl, ndc, raycaster, camera, widthN, heightN, settings.cellSize],
  )

  // Placement: in markers mode with a place selected, a click on the terrain
  // drops that marker on the clicked cell. Stable listener; reads live state.
  const live = useRef(null)
  live.current = { mode, pendingPlaceId, onPlaceMarker }
  useEffect(() => {
    const el = gl.domElement
    const onDown = (e) => {
      const L = live.current
      if (L.mode !== 'markers' || !L.pendingPlaceId || e.button !== 0) return
      const cell = aimCell(e.clientX, e.clientY)
      if (cell) {
        e.preventDefault()
        L.onPlaceMarker(L.pendingPlaceId, cell)
      }
    }
    el.addEventListener('pointerdown', onDown)
    return () => el.removeEventListener('pointerdown', onDown)
  }, [gl, aimCell])

  // Reproject the DOM billboards whenever the data or terrain changes (the scene
  // renders on demand, so without this nudge a marker added while the camera is
  // still wouldn't appear until the next interaction).
  useEffect(() => {
    invalidate()
  }, [markers, structRev, dragCell, invalidate])

  const setLiveCell = (c) => {
    dragCellRef.current = c
    setDragCell(c)
  }

  const startDrag = (placeId, e) => {
    if (mode !== 'markers' || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    movedRef.current = false
    setDragId(placeId)
    setLiveCell(null)
    const onMove = (ev) => {
      const cell = aimCell(ev.clientX, ev.clientY)
      if (cell) {
        movedRef.current = true
        setLiveCell(cell)
        invalidate()
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const cell = dragCellRef.current
      setDragId(null)
      setLiveCell(null)
      if (movedRef.current && cell) onMoveMarker(placeId, cell)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Labels are always on while editing markers (you need to see what you place);
  // otherwise gated by zoom, with per-marker hover/tap reveal on top.
  const labelsForced = mode === 'markers'

  return markers.map((m) => {
    const cell = dragId === m.placeId && dragCell ? dragCell : m
    const { x, y, z } = markerWorldPos(cell.col, cell.row, heightsRef.current, widthN, heightN, settings)
    const showLabel = labelsForced || zoomedIn || hoverId === m.placeId || revealId === m.placeId
    return (
      <Html
        key={m.placeId}
        position={[x, y, z]}
        center
        zIndexRange={[20, 0]}
        className="marker-html"
      >
        <button
          type="button"
          className={`map-marker ${dragId === m.placeId ? 'dragging' : ''} ${showLabel ? '' : 'label-off'}`}
          style={{ pointerEvents: mode === 'edit' || mode === 'regions' ? 'none' : 'auto' }}
          onPointerDown={(e) => {
            pointerKindRef.current = e.pointerType || 'mouse'
            startDrag(m.placeId, e)
          }}
          onPointerEnter={(e) => {
            if (e.pointerType === 'mouse') setHoverId(m.placeId)
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setHoverId((h) => (h === m.placeId ? null : h))
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (movedRef.current) {
              movedRef.current = false
              return // that was a drag, not a tap
            }
            // Touch, zoomed out, label hidden → first tap reveals the label
            // instead of opening; a second tap (now revealed) opens the card.
            const visible = labelsForced || zoomedIn || hoverId === m.placeId || revealId === m.placeId
            if (pointerKindRef.current !== 'mouse' && !visible) {
              setRevealId(m.placeId)
              invalidate()
              return
            }
            setRevealId(null)
            onOpenMarker(m.placeId)
          }}
          title={m.name || '(ohne Namen)'}
        >
          <span className={`marker-label ${m.name_final ? '' : 'provisional'}`}>
            {m.name || '(ohne Namen)'}
          </span>
          <MapPin className="marker-pin" size={18} />
        </button>
      </Html>
    )
  })
}

// Spread tokens that share a place around a small ring so they don't overlap.
function clusterOffset(i, n, cellSize) {
  if (n <= 1) return [0, 0]
  const ring = cellSize * (0.55 + 0.35 * Math.floor(i / 8))
  const ang = (2 * Math.PI * (i % 8)) / Math.min(n, 8)
  return [Math.cos(ang) * ring, Math.sin(ang) * ring]
}

// Timeline layer: character tokens at their per-chapter places, plus an event
// indicator on places with chapter-linked events. Tokens are DOM billboards
// (drei <Html>) showing the character's portrait thumbnail (or an initial when
// none), with the name in provisional styling; clicking one opens that
// character's card. Tokens are interactive only in timeline mode. Positions are
// read from the place coords (same source as the markers) and float above the
// terrain at the cell's current height.
function Tokens({
  widthN,
  heightN,
  settings,
  heightsRef,
  tokens,
  eventPlaces,
  getPortraitUrl,
  onOpenCharacter,
  mode,
  structRev,
}) {
  const invalidate = useThree((s) => s.invalidate)
  const [urls, setUrls] = useState({}) // portrait_path → object URL (or null)

  // Resolve portrait thumbnails lazily; cache by path so we fetch each once.
  useEffect(() => {
    let cancelled = false
    const paths = [...new Set(tokens.map((t) => t.portrait_path).filter(Boolean))]
    const missing = paths.filter((p) => !(p in urls))
    if (!missing.length) return
    Promise.all(
      missing.map(async (p) => [p, await getPortraitUrl(p).catch(() => null)]),
    ).then((pairs) => {
      if (cancelled) return
      setUrls((cur) => {
        const next = { ...cur }
        for (const [p, u] of pairs) next[p] = u
        return next
      })
      invalidate()
    })
    return () => {
      cancelled = true
    }
  }, [tokens, getPortraitUrl, urls, invalidate])

  // Revoke object URLs when the layer unmounts (avoid blob leaks).
  const urlsRef = useRef(urls)
  urlsRef.current = urls
  useEffect(
    () => () => {
      Object.values(urlsRef.current).forEach((u) => u && URL.revokeObjectURL(u))
    },
    [],
  )

  // Reproject billboards when the data or terrain changes (on-demand frameloop).
  useEffect(() => {
    invalidate()
  }, [tokens, eventPlaces, structRev, invalidate])

  const pointer = mode === 'timeline' ? 'auto' : 'none'

  return (
    <>
      {eventPlaces.map((ep) => {
        const { x, y, z } = markerWorldPos(
          ep.col, ep.row, heightsRef.current, widthN, heightN, settings, MARKER_FLOAT + 3,
        )
        return (
          <Html key={`ev-${ep.placeId}`} position={[x, y, z]} center zIndexRange={[18, 0]} className="token-html">
            <span className="event-indicator" title={`${ep.count} Ereignis(se) in diesem Kapitel`}>
              <CalendarClock size={12} /> {ep.count}
            </span>
          </Html>
        )
      })}
      {tokens.map((t) => {
        const [ox, oz] = clusterOffset(t.clusterIndex, t.clusterCount, settings.cellSize)
        const base = markerWorldPos(
          t.col, t.row, heightsRef.current, widthN, heightN, settings, MARKER_FLOAT + 1.5,
        )
        const url = t.portrait_path ? urls[t.portrait_path] : null
        return (
          <Html
            key={t.characterId}
            position={[base.x + ox, base.y, base.z + oz]}
            center
            zIndexRange={[22, 0]}
            className="token-html"
          >
            <button
              type="button"
              className="char-token"
              style={{ pointerEvents: pointer }}
              onClick={(e) => {
                e.stopPropagation()
                onOpenCharacter(t.characterId)
              }}
              title={t.name || '(ohne Namen)'}
            >
              <span className="token-portrait">
                {url ? (
                  <img src={url} alt="" />
                ) : (
                  <span className="token-initial">{(t.name || '?').trim().charAt(0).toUpperCase()}</span>
                )}
              </span>
              <span className={`token-label ${t.name_final ? '' : 'provisional'}`}>
                {t.name || '(ohne Namen)'}
              </span>
            </button>
          </Html>
        )
      })}
    </>
  )
}

// Regions layer: auto-drawn borders + name labels from the per-cell assignment.
// A border line is drawn on every edge between two cells of DIFFERENT regions
// (region-vs-region or region-vs-none, incl. the grid rim), so outlines appear
// automatically. Each region's name is labelled at the centroid of its cells,
// tinted with the region colour. Borders are one LineSegments draw call; the
// whole layer toggles off via `visible` so it never gets in the way of sculpting.
function RegionsLayer({
  widthN,
  heightN,
  settings,
  heightsRef,
  regionsRef,
  regionSlotsRef,
  regions,
  regionRev,
  structRev,
  visible,
}) {
  const invalidate = useThree((s) => s.invalidate)
  const { cellSize, step } = settings
  const regionsById = useMemo(() => new Map((regions || []).map((r) => [r.id, r])), [regions])

  const { positions, labels } = useMemo(() => {
    const buf = regionsRef.current
    if (!buf || !visible) return { positions: new Float32Array(0), labels: [] }
    const slots = regionSlotsRef.current || []
    const heights = heightsRef.current
    const yTop = (i) => heights[i] * step
    const pos = []
    for (let y = 0; y < heightN; y++) {
      for (let x = 0; x < widthN; x++) {
        const i = y * widthN + x
        const a = buf[i]
        const rb = x + 1 < widthN ? buf[i + 1] : 0
        if (a !== rb) {
          const { x: px, z: pz } = cellToWorld(x, y, widthN, heightN, cellSize)
          const ex = px + cellSize / 2
          const yy = Math.max(yTop(i), x + 1 < widthN ? yTop(i + 1) : yTop(i)) + step * 0.25
          pos.push(ex, yy, pz - cellSize / 2, ex, yy, pz + cellSize / 2)
        }
        const bb = y + 1 < heightN ? buf[i + widthN] : 0
        if (a !== bb) {
          const { x: px, z: pz } = cellToWorld(x, y, widthN, heightN, cellSize)
          const ez = pz + cellSize / 2
          const yy = Math.max(yTop(i), y + 1 < heightN ? yTop(i + widthN) : yTop(i)) + step * 0.25
          pos.push(px - cellSize / 2, yy, ez, px + cellSize / 2, yy, ez)
        }
      }
    }
    const centroids = computeRegionCentroids(buf, widthN, heightN)
    const labels = []
    for (const [slot, c] of centroids) {
      const region = regionsById.get(slots[slot - 1])
      if (!region) continue // slot maps to a deleted region → treat as none
      const p = markerWorldPos(c.col, c.row, heights, widthN, heightN, settings, MARKER_FLOAT + 0.5)
      labels.push({ id: region.id, name: region.name, colour: region.colour, pos: [p.x, p.y, p.z] })
    }
    return { positions: new Float32Array(pos), labels }
  }, [regionRev, structRev, visible, widthN, heightN, cellSize, step, settings, regionsById, regionsRef, regionSlotsRef, heightsRef])

  // Expose a summary for e2e/debug; nudge a frame so on-demand rendering updates.
  useEffect(() => {
    window.__mapRegions = { borderSegments: positions.length / 6, labels: labels.map((l) => l.name) }
    invalidate()
    return () => { if (window.__mapRegions) delete window.__mapRegions }
  }, [positions, labels, invalidate])

  if (!visible) return null
  return (
    <>
      {positions.length > 0 && (
        <lineSegments key={`${regionRev}-${structRev}`} renderOrder={4} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#f2f5f8" transparent opacity={0.95} depthTest={false} />
        </lineSegments>
      )}
      {labels.map((l) => (
        <Html key={l.id} position={l.pos} center zIndexRange={[15, 0]} className="token-html">
          <span className="region-label" style={{ color: l.colour, borderColor: l.colour }}>{l.name}</span>
        </Html>
      ))}
    </>
  )
}

// Route / journey layer: polylines through ordered places, floating above the
// terrain. `lines` are pre-resolved to place-id lists by MapBuilder; here we map
// each place id to its cell's world position (live with the terrain height) and
// draw a line. A place without coords breaks the line into sub-segments (the
// visible gap = the indicated missing coordinate). Character journeys are solid
// with an emphasised dot at the current (carried-forward) position; authored
// routes are dashed, so the two never read as the same thing.
const JOURNEY_FLOAT = 1.0
const ROUTE_FLOAT = 1.7
function RoutesLayer({ widthN, heightN, settings, heightsRef, placeCoords, lines, rev, structRev }) {
  const invalidate = useThree((s) => s.invalidate)

  const built = useMemo(() => {
    const pointFor = (placeId, floatU) => {
      const c = placeCoords.get(placeId)
      if (!c) return null
      const p = markerWorldPos(c.col, c.row, heightsRef.current, widthN, heightN, settings, floatU)
      return [p.x, p.y, p.z]
    }
    return (lines || []).map((line) => {
      const floatU = line.dashed ? ROUTE_FLOAT : JOURNEY_FLOAT
      const segments = []
      let cur = []
      let last = null
      for (const pid of line.placeIds) {
        const pt = pointFor(pid, floatU)
        if (!pt) {
          if (cur.length >= 2) segments.push(cur)
          cur = []
          continue
        }
        cur.push(pt)
        last = pt
      }
      if (cur.length >= 2) segments.push(cur)
      return {
        key: line.key,
        colour: line.colour,
        dashed: !!line.dashed,
        segments,
        current: line.emphasize ? last : null,
        points: segments.reduce((n, s) => n + s.length, 0),
      }
    })
  }, [lines, rev, structRev, placeCoords, widthN, heightN, settings, heightsRef])

  useEffect(() => {
    window.__mapRoutes = {
      lines: built.map((b) => ({ key: b.key, colour: b.colour, dashed: b.dashed, points: b.points, segs: b.segments.length, hasCurrent: !!b.current })),
    }
    invalidate()
    return () => { if (window.__mapRoutes) delete window.__mapRoutes }
  }, [built, invalidate])

  return built.map((b) => (
    <group key={b.key}>
      {b.segments.map((seg, i) => (
        <Line
          key={i}
          points={seg}
          color={b.colour}
          lineWidth={b.dashed ? 2.5 : 3.5}
          dashed={b.dashed}
          dashSize={0.7}
          gapSize={0.4}
          transparent
          opacity={0.95}
          renderOrder={5}
        />
      ))}
      {b.current && (
        <mesh position={b.current} renderOrder={6}>
          <sphereGeometry args={[settings.cellSize * 0.35, 14, 14]} />
          <meshBasicMaterial color={b.colour} />
        </mesh>
      )}
    </group>
  ))
}

// Deterministic camera: on mount AND on every reset, snap to a canonical view —
// due SOUTH of centre, ~45° up, looking due NORTH (-Z) at the origin — so the
// map ALWAYS opens correctly oriented. Also reports the camera heading (azimuth)
// upward so the DOM compass can reflect which way we're facing.
function ViewController({ gridD, resetSignal, onHeading, northOffsetRef }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const invalidate = useThree((s) => s.invalidate)

  const applyDefault = useCallback(() => {
    if (!controls) return
    // drei's OrbitControls enables damping, so update() only DECAYS the leftover
    // rotate/pan delta from a drag — never zeroes it — which would drift the
    // reset. Temporarily disable damping: the first update() then fully clears
    // that delta, and the second snaps EXACTLY to the target pose.
    const wasDamping = controls.enableDamping
    controls.enableDamping = false
    controls.update()
    // Place the camera opposite the chosen North so North is oriented AWAY (up)
    // on screen. northOffsetRef is read live (a ref, not a dep) so changing
    // North does NOT yank the camera — only reset/open re-aligns it.
    const t = ((northOffsetRef?.current || 0) * Math.PI) / 180
    const d = gridD * 0.85
    camera.position.set(d * Math.sin(t), gridD * 0.8, d * Math.cos(t))
    camera.up.set(0, 1, 0)
    controls.target.set(0, 0, 0)
    controls.update()
    controls.enableDamping = wasDamping
    invalidate()
    onHeading?.(controls.getAzimuthalAngle())
  }, [camera, controls, gridD, invalidate, onHeading, northOffsetRef])

  // Mount + reset button. applyDefault changes identity once `controls` exists,
  // so this also fires as soon as OrbitControls has registered.
  useEffect(() => {
    applyDefault()
  }, [resetSignal, applyDefault])

  // Keep the compass in sync with manual orbiting.
  useEffect(() => {
    if (!controls) return
    const report = () => onHeading?.(controls.getAzimuthalAngle())
    controls.addEventListener('change', report)
    report()
    return () => controls.removeEventListener('change', report)
  }, [controls, onHeading])

  return null
}

// Expose the live camera / controls on window for debugging and e2e checks.
// Read-only references; harmless in this single-user PWA.
function DebugHook() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const controls = useThree((s) => s.controls)
  useEffect(() => {
    window.__luminiMap = { camera, gl, scene, controls }
    return () => {
      if (window.__luminiMap && window.__luminiMap.camera === camera) delete window.__luminiMap
    }
  }, [camera, gl, controls])
  return null
}

export default function TerrainScene(props) {
  const { widthN, heightN, settings, mode, resetSignal, onHeading, northOffset, northOffsetRef } = props
  const gridD = Math.max(widthN, heightN) * settings.cellSize
  const northRad = ((northOffset || 0) * Math.PI) / 180
  // One shared handle on the terrain InstancedMesh: Cells writes it, the marker
  // layer raycasts against it for placement / dragging.
  const terrainMeshRef = useRef(null)
  return (
    <Canvas
      dpr={[1, 2]}
      frameloop="demand"
      camera={{ position: [0, gridD * 0.8, gridD * 0.85], fov: 45, near: 0.1, far: gridD * 10 }}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={['#0b1220']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[gridD, gridD * 1.6, gridD * 0.6]} intensity={1.15} />
      <Cells {...props} meshRef={terrainMeshRef} />
      <WaterPlane widthN={widthN} heightN={heightN} settings={settings} seaLevel={props.seaLevel} />
      <RegionsLayer
        widthN={widthN}
        heightN={heightN}
        settings={settings}
        heightsRef={props.heightsRef}
        regionsRef={props.regionsRef}
        regionSlotsRef={props.regionSlotsRef}
        regions={props.regions}
        regionRev={props.regionRev}
        structRev={props.structRev}
        visible={props.regionsVisible}
      />
      <Cardinals widthN={widthN} heightN={heightN} settings={settings} northRad={northRad} />
      <Markers
        meshRef={terrainMeshRef}
        widthN={widthN}
        heightN={heightN}
        settings={settings}
        heightsRef={props.heightsRef}
        mode={mode}
        markers={props.markers || []}
        pendingPlaceId={props.pendingPlaceId}
        onPlaceMarker={props.onPlaceMarker}
        onMoveMarker={props.onMoveMarker}
        onOpenMarker={props.onOpenMarker}
        structRev={props.structRev}
      />
      <RoutesLayer
        widthN={widthN}
        heightN={heightN}
        settings={settings}
        heightsRef={props.heightsRef}
        placeCoords={props.placeCoords || new Map()}
        lines={props.routeLines || []}
        rev={props.routesRev}
        structRev={props.structRev}
      />
      <Tokens
        widthN={widthN}
        heightN={heightN}
        settings={settings}
        heightsRef={props.heightsRef}
        tokens={props.tokens || []}
        eventPlaces={props.eventPlaces || []}
        getPortraitUrl={props.getPortraitUrl}
        onOpenCharacter={props.onOpenCharacter}
        mode={mode}
        structRev={props.structRev}
      />
      <ViewController
        gridD={gridD}
        resetSignal={resetSignal}
        onHeading={onHeading}
        northOffsetRef={northOffsetRef}
      />
      <DebugHook />
      <OrbitControls
        makeDefault
        enabled={mode === 'navigate' || mode === 'timeline' || mode === 'routes'}
        enablePan
        enableZoom
        enableRotate
        // Zoom toward the pointer instead of always toward the centre, and pan
        // in screen space — together these let you reach every edge and corner:
        // zoom into a corner, then pan the view freely across the whole map.
        // Touch: one finger rotates, two fingers pinch-zoom + pan (drei default).
        zoomToCursor
        screenSpacePanning
        target={[0, 0, 0]}
        maxPolarAngle={1.45}
        minDistance={gridD * 0.04}
        maxDistance={gridD * 4}
      />
    </Canvas>
  )
}
