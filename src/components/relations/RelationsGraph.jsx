import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../state/store.jsx'
import { primaryImagePath } from '../../lib/portraits.js'
import { familyLayout, forceLayout } from '../../lib/relationships.js'

// The relationship graph itself: plain SVG, no graph library — the layouts live
// in lib/relationships.js (a deterministic force simulation for the network
// view, a generation layout for the family tree). Loaded lazily by
// RelationsView so none of this is in the start-up bundle.
//
// Nodes carry a portrait thumbnail (or initials) and the character's name, with
// the provisional-name styling of the rest of the app. Entered relationships
// are solid, DERIVED ones dashed and muted; uncertain/secret ones are dotted.
const R = 26 // node radius
const LABEL_GAP = 16

export default function RelationsGraph({
  nodes,
  edges,
  relationships,
  familyOnly,
  focusId,
  onFocus,
  onOpen,
}) {
  const wrapRef = useRef(null)
  const [size, setSize] = useState({ w: 1000, h: 700 })
  const [view, setView] = useState(null) // { tx, ty, scale }
  const [hover, setHover] = useState(null)
  const drag = useRef(null)

  // Pane size (rounded, so a pixel of resizing doesn't relayout the graph).
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setSize({ w: Math.max(400, Math.round(r.width / 50) * 50), h: Math.max(320, Math.round(r.height / 50) * 50) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(() => {
    if (familyOnly) return familyLayout(nodes, relationships)
    const iterations = Math.max(90, Math.min(320, Math.round(24000 / Math.max(1, nodes.length))))
    return forceLayout(nodes, edges, { width: size.w, height: size.h, iterations })
  }, [familyOnly, nodes, edges, relationships, size.w, size.h])

  // Fit the content into the pane whenever the graph or the mode changes.
  const bounds = useMemo(() => {
    const pts = [...layout.values()]
    if (!pts.length) return { x: 0, y: 0, w: size.w, h: size.h }
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const pad = R * 3
    return {
      x: Math.min(...xs) - pad,
      y: Math.min(...ys) - pad,
      w: Math.max(1, Math.max(...xs) - Math.min(...xs) + pad * 2),
      h: Math.max(1, Math.max(...ys) - Math.min(...ys) + pad * 2),
    }
  }, [layout, size.w, size.h])

  const fit = () => {
    const scale = Math.min(size.w / bounds.w, size.h / bounds.h, 1.4)
    setView({
      scale,
      tx: (size.w - bounds.w * scale) / 2 - bounds.x * scale,
      ty: (size.h - bounds.h * scale) / 2 - bounds.y * scale,
    })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fit, [bounds.x, bounds.y, bounds.w, bounds.h, size.w, size.h])

  const v = view || { tx: 0, ty: 0, scale: 1 }
  const zoomAt = (factor, cx, cy) => {
    setView((cur) => {
      const s = cur || v
      const scale = Math.max(0.15, Math.min(3, s.scale * factor))
      const k = scale / s.scale
      return { scale, tx: cx - (cx - s.tx) * k, ty: cy - (cy - s.ty) * k }
    })
  }
  function onWheel(e) {
    e.preventDefault()
    const r = wrapRef.current.getBoundingClientRect()
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top)
  }
  function onPointerDown(e) {
    if (e.target.closest('.rg-node')) return // node clicks are not pans
    drag.current = { x: e.clientX, y: e.clientY, tx: v.tx, ty: v.ty }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function onPointerMove(e) {
    const d = drag.current
    if (!d) return
    setView((cur) => ({ ...(cur || v), tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) }))
  }
  const endDrag = () => { drag.current = null }

  // Portraits for the visible nodes (resolved once per path, revoked on change).
  const urls = usePortraits(nodes)

  const pos = (id) => layout.get(id)
  const showLabels = v.scale > 0.55

  return (
    <div className="rg-wrap" ref={wrapRef}>
      <div className="rg-controls">
        <button className="icon-btn" title="Hineinzoomen" aria-label="Hineinzoomen" onClick={() => zoomAt(1.2, size.w / 2, size.h / 2)}>+</button>
        <button className="icon-btn" title="Herauszoomen" aria-label="Herauszoomen" onClick={() => zoomAt(1 / 1.2, size.w / 2, size.h / 2)}>−</button>
        <button className="toggle rg-fit" onClick={fit}>Ansicht einpassen</button>
      </div>
      <svg
        className="rg-svg"
        width="100%"
        height="100%"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <defs>
          <marker id="rg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="rg-arrow-head" />
          </marker>
          {nodes.map((n) => (
            <clipPath key={n.id} id={`rg-clip-${n.id}`}>
              <circle cx={0} cy={0} r={R - 2} />
            </clipPath>
          ))}
        </defs>
        <g transform={`translate(${v.tx} ${v.ty}) scale(${v.scale})`}>
          {edges.map((e, i) => {
            const a = pos(e.from)
            const b = pos(e.to)
            if (!a || !b) return null
            const cls = [
              'rg-edge',
              e.derived ? 'derived' : 'entered',
              e.uncertain ? 'uncertain' : '',
              hover && (hover === e.from || hover === e.to) ? 'hl' : '',
            ].join(' ')
            // Family tree: parent→child runs as an elbow, so generations read
            // as rows instead of a web of diagonals.
            const elbow = familyOnly && e.type === 'elternteil'
            const d = elbow
              ? `M ${a.x} ${a.y + R} V ${(a.y + b.y) / 2} H ${b.x} V ${b.y - R}`
              : `M ${a.x} ${a.y} L ${b.x} ${b.y}`
            return (
              <g key={`${e.id}-${i}`}>
                <path
                  className={cls}
                  d={d}
                  markerEnd={e.directional ? 'url(#rg-arrow)' : undefined}
                />
                {showLabels && (
                  <text
                    className={`rg-edge-label ${e.derived ? 'derived' : ''}`}
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 4}
                    textAnchor="middle"
                  >
                    {e.label}
                  </text>
                )}
              </g>
            )
          })}
          {nodes.map((n) => {
            const p = pos(n.id)
            if (!p) return null
            const url = urls[primaryImagePath(n) || ''] || null
            const initials = (n.name || '?')
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0])
              .join('')
            return (
              <g
                key={n.id}
                className={`rg-node ${n.name_final ? '' : 'provisional'} ${focusId === n.id ? 'focused' : ''}`}
                transform={`translate(${p.x} ${p.y})`}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
                onClick={() => onOpen(n.id)}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => e.key === 'Enter' && onOpen(n.id)}
              >
                <title>{`${n.name} — Karte öffnen`}</title>
                <circle className="rg-node-bg" r={R} />
                {url ? (
                  <image
                    href={url}
                    x={-(R - 2)}
                    y={-(R - 2)}
                    width={(R - 2) * 2}
                    height={(R - 2) * 2}
                    clipPath={`url(#rg-clip-${n.id})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                ) : (
                  <text className="rg-initials" y={5} textAnchor="middle">
                    {initials}
                  </text>
                )}
                <circle className="rg-node-ring" r={R} />
                {showLabels && (
                  <text className="rg-node-label" y={R + LABEL_GAP} textAnchor="middle">
                    {n.name}
                  </text>
                )}
                {/* Isolate this node's neighbourhood (clicking the node opens
                    the card, so focusing gets its own small handle). */}
                <g
                  className="rg-focus"
                  transform={`translate(${R - 4} ${-R + 4})`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onFocus(focusId === n.id ? null : n.id)
                  }}
                >
                  <title>{focusId === n.id ? 'Fokus aufheben' : 'Nur Umgebung zeigen'}</title>
                  <circle r={9} />
                  <path d="M -4 0 H 4 M 0 -4 V 4" />
                </g>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

// path → object URL for the nodes' primary portraits. Each path is resolved
// once; blob URLs are revoked when the set changes or the graph unmounts.
function usePortraits(nodes) {
  const { getPortraitUrl } = useStore()
  const [urls, setUrls] = useState({})
  const paths = nodes.map((n) => primaryImagePath(n)).filter(Boolean).sort().join('|')

  useEffect(() => {
    let cancelled = false
    const created = []
    const list = paths ? paths.split('|') : []
    ;(async () => {
      const out = {}
      for (const path of list) {
        try {
          const u = await getPortraitUrl(path)
          if (!u) continue
          if (u.startsWith('blob:')) created.push(u)
          out[path] = u
        } catch {
          /* a missing portrait just falls back to initials */
        }
      }
      if (!cancelled) setUrls(out)
    })()
    return () => {
      cancelled = true
      for (const u of created) URL.revokeObjectURL(u)
    }
  }, [paths, getPortraitUrl])

  return urls
}
