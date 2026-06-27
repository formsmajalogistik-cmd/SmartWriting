import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import {
  cellToWorld,
  worldToCell,
  inBounds,
  colorForCell,
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
  beginStroke,
  paintCell,
  endStroke,
  structRev,
  colorRev,
}) {
  const meshRef = useRef(null)
  const painting = useRef(false)
  const { invalidate } = useThree()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const tmpColor = useMemo(() => new THREE.Color(), [])

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
      const colH = h * step + baseDepth
      dummy.position.set(px, (h * step - baseDepth) / 2, pz)
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

  // Full rebuild: initial mount, terrain (re)load, undo/redo.
  useEffect(() => {
    for (let i = 0; i < count; i++) writeInstance(i)
    flush()
  }, [structRev, count, writeInstance, flush])

  // Sea-level changes don't move cells, only recolour them (and the waterline).
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    for (let i = 0; i < count; i++) {
      const h = heightsRef.current[i]
      const type = typesRef.current ? typesRef.current[i] : 0
      tmpColor.set(colorForCell(h, seaLevel, maxHeight, type))
      mesh.setColorAt(i, tmpColor)
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    invalidate()
  }, [colorRev, seaLevel, count, maxHeight, heightsRef, typesRef, tmpColor, invalidate])

  // End the stroke even if the pointer is released off the mesh / off-canvas.
  useEffect(() => {
    function up() {
      if (painting.current) {
        painting.current = false
        endStroke()
      }
    }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [endStroke])

  function pick(e) {
    const c = worldToCell(e.point.x, e.point.z, widthN, heightN, cellSize)
    return inBounds(c.x, c.y, widthN, heightN) ? c : null
  }

  function applyChanged(indices) {
    if (!indices || !indices.length) return
    for (const i of indices) writeInstance(i)
    flush()
  }

  function onPointerDown(e) {
    if (mode !== 'edit') return // navigate mode → let OrbitControls have the drag
    e.stopPropagation()
    painting.current = true
    beginStroke()
    const c = pick(e)
    if (c) applyChanged(paintCell(c.x, c.y))
  }

  function onPointerMove(e) {
    if (mode !== 'edit' || !painting.current) return
    const c = pick(e)
    if (c) applyChanged(paintCell(c.x, c.y))
  }

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      frustumCulled={false}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial vertexColors flatShading />
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

export default function TerrainScene(props) {
  const { widthN, heightN, settings, mode } = props
  const gridD = Math.max(widthN, heightN) * settings.cellSize
  return (
    <Canvas
      dpr={[1, 2]}
      frameloop="demand"
      camera={{ position: [0, gridD * 0.85, gridD * 0.95], fov: 45, near: 0.1, far: gridD * 10 }}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={['#0b1220']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[gridD, gridD * 1.6, gridD * 0.6]} intensity={1.15} />
      <Cells {...props} />
      <WaterPlane widthN={widthN} heightN={heightN} settings={settings} seaLevel={props.seaLevel} />
      <OrbitControls
        makeDefault
        enabled={mode === 'navigate'}
        enablePan
        enableZoom
        enableRotate
        target={[0, 0, 0]}
        maxPolarAngle={1.45}
        minDistance={gridD * 0.15}
        maxDistance={gridD * 4}
      />
    </Canvas>
  )
}
