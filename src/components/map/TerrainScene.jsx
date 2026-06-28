import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import {
  cellToWorld,
  worldToCell,
  inBounds,
  colorForCell,
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
  structRev,
}) {
  const meshRef = useRef(null)
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
  live.current = { mode, tool, beginStroke, paintCell, endStroke, fillCell, applyChanged }

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
      if (live.current.mode !== 'edit' || e.button !== 0) return
      e.preventDefault()
      aim(e)
      const start = cellOnMesh()
      if (!start) return
      // Fill is a single click — flood the region, no drag/capture.
      if (live.current.tool === 'fill') {
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

// Fixed N/E/S/W markers anchored in WORLD space (at the grid's edge midpoints),
// so they always point at the true cardinal directions no matter how the camera
// orbits. North is -Z (see model.js). Rendered as DOM labels via drei <Html>.
function Cardinals({ widthN, heightN, settings }) {
  const { cellSize, step } = settings
  const halfX = (widthN * cellSize) / 2
  const halfZ = (heightN * cellSize) / 2
  const margin = cellSize * 3
  const y = step * 3
  const posFor = ([dx, dz]) => [dx * (halfX + margin), y, dz * (halfZ + margin)]
  return (
    <>
      {CARDINALS.map((c) => (
        <Html key={c.key} position={posFor(c.dir)} center zIndexRange={[5, 0]} className="cardinal-html">
          <span className={`cardinal-label ${c.key === 'N' ? 'north' : ''}`}>{c.label}</span>
        </Html>
      ))}
    </>
  )
}

// Deterministic camera: on mount AND on every reset, snap to a canonical view —
// due SOUTH of centre, ~45° up, looking due NORTH (-Z) at the origin — so the
// map ALWAYS opens correctly oriented. Also reports the camera heading (azimuth)
// upward so the DOM compass can reflect which way we're facing.
function ViewController({ gridD, resetSignal, onHeading }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const invalidate = useThree((s) => s.invalidate)

  const applyDefault = useCallback(() => {
    if (!controls) return
    // drei's OrbitControls enables damping, so update() only DECAYS the leftover
    // rotate/pan delta from a drag — never zeroes it — which would drift the
    // reset. Temporarily disable damping: the first update() then fully clears
    // that delta, and the second snaps EXACTLY to due north (azimuth 0).
    const wasDamping = controls.enableDamping
    controls.enableDamping = false
    controls.update()
    camera.position.set(0, gridD * 0.8, gridD * 0.85) // +Z = south, above → looks north
    camera.up.set(0, 1, 0)
    controls.target.set(0, 0, 0)
    controls.update()
    controls.enableDamping = wasDamping
    invalidate()
    onHeading?.(controls.getAzimuthalAngle())
  }, [camera, controls, gridD, invalidate, onHeading])

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
  const { widthN, heightN, settings, mode, resetSignal, onHeading } = props
  const gridD = Math.max(widthN, heightN) * settings.cellSize
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
      <Cells {...props} />
      <WaterPlane widthN={widthN} heightN={heightN} settings={settings} seaLevel={props.seaLevel} />
      <Cardinals widthN={widthN} heightN={heightN} settings={settings} />
      <ViewController gridD={gridD} resetSignal={resetSignal} onHeading={onHeading} />
      <DebugHook />
      <OrbitControls
        makeDefault
        enabled={mode === 'navigate'}
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
