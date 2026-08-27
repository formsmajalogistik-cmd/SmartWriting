import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Marked } from 'marked'
import { Bold, Italic, User, MapPin, Flag, Mountain, Map as MapIcon } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { makeResolver, hashlinkExtension, cardAliases } from '../lib/hashlinks.js'
import { noBlockquote, GUILLEMET_MAP } from '../lib/markdown.js'
import { getCaretCoordinates } from '../lib/caret.js'
import CardPreview from './CardPreview.jsx'

// Distraction-light Markdown editor with #Name linking.
// - Typing "#…" opens an autocomplete over character + place cards; selecting
//   inserts the literal "#Name" into the Markdown (no hidden ids).
// - The preview pane renders #Name tokens as resolved / provisional / unresolved
//   links; hovering or tapping a resolved link shows a compact card preview.
// - German dialogue quotes: typing ">" inserts » and "<" inserts « (direct
//   substitution, no auto-pairing) — toggleable in the Profil tab. Markdown
//   blockquotes are disabled (a "> " line renders literally).
const PARTIAL_RE = /#([\p{L}\p{N}_'’\-]*)$/u
const NAME_CHAR = /[\p{L}\p{N}]/u

// Autocomplete / preview icon per linkable kind.
const KIND_ICONS = { character: User, place: MapPin, region: Flag, geo: Mountain }

// ---- typewriter-style caret following --------------------------------------
// A textarea only scrolls far enough to put the caret on the LAST visible line,
// which is why the line being written sat at the very bottom edge. Instead the
// caret is kept inside a comfortable band; when it leaves, the view scrolls so
// the active line rests near CARET_TARGET — always with open space beneath.
// The band is a dead zone: while the caret sits inside it nothing moves, so
// typing never jitters and manual scrolling is left alone.
const CARET_BAND_TOP = 0.15 // never above this fraction of the visible height
const CARET_BAND_BOTTOM = 0.55 // …nor below this one
const CARET_TARGET = 0.45 // where the active line lands after a scroll
const CARET_MIN_TAIL = 140 // px of breathing room below, on short viewports
// Caret keys that should pull the view along (the popup handles its own keys).
const NAV_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End',
])

// Caret position in VIEWPORT coordinates — the anchor the popup hangs off.
function caretAnchor(ta, index) {
  const coords = getCaretCoordinates(ta, index)
  const rect = ta.getBoundingClientRect()
  const top = rect.top + coords.top - ta.scrollTop
  return { top, bottom: top + coords.height, left: rect.left + coords.left - ta.scrollLeft }
}

export default function Editor({ value, onChange, preview, focusSelection, onFocusApplied }) {
  const { characters, places, regions, geoFeatures, openCard, openOnMap, editorGuillemets } = useStore()
  const taRef = useRef(null)
  const popRef = useRef(null)

  // Keep the caret inside the comfortable band (see the constants above).
  // Only ever called from a user's own text/caret action — never from a scroll
  // handler — so scrolling by hand is never fought.
  function keepCaretInView() {
    const ta = taRef.current
    if (!ta) return
    const view = ta.clientHeight
    if (!view) return
    const { top, height } = getCaretCoordinates(ta, ta.selectionEnd)
    // The lower edge of the band: whichever leaves MORE room underneath.
    const bandBottom = ta.scrollTop + Math.min(view * CARET_BAND_BOTTOM, view - CARET_MIN_TAIL)
    const bandTop = ta.scrollTop + view * CARET_BAND_TOP
    if (top + height <= bandBottom && top >= bandTop) return // inside → hold still
    const max = Math.max(0, ta.scrollHeight - view)
    const next = Math.max(0, Math.min(top - view * CARET_TARGET, max))
    if (Math.abs(next - ta.scrollTop) > 1) ta.scrollTop = next
  }
  // Run after React has committed the new value (and the browser has laid the
  // text out), so the caret measurement matches what is on screen.
  const followRef = useRef(0)
  function scheduleCaretFollow() {
    cancelAnimationFrame(followRef.current)
    followRef.current = requestAnimationFrame(keepCaretInView)
  }
  useEffect(() => () => cancelAnimationFrame(followRef.current), [])

  // Jump-to-match from manuscript search: focus the textarea and select the
  // match range, then place it comfortably in view (not jammed at the edge).
  useEffect(() => {
    if (!focusSelection) return
    const ta = taRef.current
    if (!ta) return
    const len = ta.value.length
    const start = Math.min(focusSelection.start ?? 0, len)
    const end = Math.min(focusSelection.end ?? start, len)
    const id = requestAnimationFrame(() => {
      ta.focus()
      try { ta.setSelectionRange(start, end) } catch { /* ignore */ }
      keepCaretInView()
      onFocusApplied?.()
    })
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSelection, onFocusApplied])

  const resolver = useMemo(
    () => makeResolver(characters, places, regions, geoFeatures),
    [characters, places, regions, geoFeatures],
  )

  const html = useMemo(() => {
    if (!preview) return ''
    const m = new Marked({ breaks: true })
    m.use(noBlockquote)
    m.use(hashlinkExtension(resolver))
    return m.parse(value || '')
  }, [preview, value, resolver])

  // ---- »« substitution ---------------------------------------------------
  // Replace a typed ">"/"<" with the German guillemet before it ever lands in
  // the text (works for keyboard and mobile IMEs via beforeinput). Pastes and
  // multi-character inputs pass through untouched.
  function onBeforeInput(e) {
    if (!editorGuillemets) return
    const sub = GUILLEMET_MAP[e.data]
    if (!sub) return
    e.preventDefault()
    const ta = taRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    onChange(ta.value.slice(0, start) + sub + ta.value.slice(end))
    requestAnimationFrame(() => {
      ta.focus()
      try { ta.setSelectionRange(start + 1, start + 1) } catch { /* ignore */ }
      keepCaretInView()
    })
  }

  // ---- #autocomplete --------------------------------------------------
  const [ac, setAc] = useState(null) // { items, index, top, left, tokenStart, caret }

  function refreshAutocomplete() {
    const ta = taRef.current
    if (!ta || ta.selectionStart !== ta.selectionEnd) return setAc(null)
    const caret = ta.selectionStart
    const before = ta.value.slice(0, caret)
    const m = before.match(PARTIAL_RE)
    if (!m) return setAc(null)
    const tokenStart = caret - m[0].length
    const prev = tokenStart > 0 ? before[tokenStart - 1] : ''
    if (prev && NAME_CHAR.test(prev)) return setAc(null) // mid-word like "C#"
    const q = m[1].toLowerCase()
    // Cards appear once per findable name: the main name plus one entry per
    // alias (alias entries insert the ALIAS but always show the main name).
    // Duplicate names each stay listed — picking the right card is the
    // author's call, never a silent guess.
    const withAliases = (rows, kind) =>
      rows.flatMap((r) => {
        const base = { id: r.id, name: r.name, kind, name_final: r.name_final }
        return [base, ...cardAliases(r).map((a) => ({ ...base, alias: a }))]
      })
    const label = (o) => o.alias || o.name
    const all = [
      ...withAliases(characters, 'character'),
      ...withAliases(places, 'place'),
      ...regions.map((r) => ({ id: r.id, name: r.name, kind: 'region', name_final: true })),
      ...geoFeatures.map((g) => ({ id: g.id, name: g.name, kind: 'geo', name_final: true })),
    ].filter((o) => label(o) && label(o).toLowerCase().includes(q))
    all.sort((a, b) => {
      const as = label(a).toLowerCase().startsWith(q) ? 0 : 1
      const bs = label(b).toLowerCase().startsWith(q) ? 0 : 1
      return as - bs || label(a).localeCompare(label(b))
    })
    const items = all.slice(0, 8)
    if (!items.length) return setAc(null)
    setAc({ items, index: 0, anchor: caretAnchor(ta, caret), tokenStart, caret })
  }

  // Keep the popup glued to the caret while the text scrolls under it (typing,
  // the caret-follow above, a resize, or the mobile keyboard opening). If the
  // caret scrolls out of the writing area entirely, the popup goes with it.
  useEffect(() => {
    if (!ac) return
    const ta = taRef.current
    if (!ta) return
    const caret = ac.caret
    const reanchor = () => {
      const a = caretAnchor(ta, caret)
      const r = ta.getBoundingClientRect()
      if (a.bottom < r.top + 2 || a.top > r.bottom - 2) return setAc(null)
      setAc((cur) => (cur ? { ...cur, anchor: a } : cur))
    }
    ta.addEventListener('scroll', reanchor, { passive: true })
    window.addEventListener('resize', reanchor)
    window.addEventListener('scroll', reanchor, true)
    window.visualViewport?.addEventListener('resize', reanchor)
    window.visualViewport?.addEventListener('scroll', reanchor)
    return () => {
      ta.removeEventListener('scroll', reanchor)
      window.removeEventListener('resize', reanchor)
      window.removeEventListener('scroll', reanchor, true)
      window.visualViewport?.removeEventListener('resize', reanchor)
      window.visualViewport?.removeEventListener('scroll', reanchor)
    }
  }, [ac?.caret, !!ac]) // eslint-disable-line react-hooks/exhaustive-deps

  function selectItem(item) {
    const ta = taRef.current
    if (!ta || !ac) return
    const before = ta.value.slice(0, ac.tokenStart)
    const after = ta.value.slice(ac.caret)
    const inserted = before + '#' + (item.alias || item.name)
    onChange(inserted + after)
    setAc(null)
    const pos = inserted.length
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(pos, pos)
      keepCaretInView()
    })
  }

  // ---- bold / italic formatting --------------------------------------
  // Wrap (or unwrap) the current selection in `marker` (** for bold, * italic).
  function wrapSelection(marker) {
    const ta = taRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const val = ta.value
    const sel = val.slice(start, end)
    const mlen = marker.length
    const before = val.slice(Math.max(0, start - mlen), start)
    const after = val.slice(end, end + mlen)
    let next, ns, ne
    if (sel.length >= 2 * mlen && sel.startsWith(marker) && sel.endsWith(marker)) {
      const inner = sel.slice(mlen, sel.length - mlen) // unwrap inside selection
      next = val.slice(0, start) + inner + val.slice(end)
      ns = start
      ne = start + inner.length
    } else if (before === marker && after === marker) {
      next = val.slice(0, start - mlen) + sel + val.slice(end + mlen) // unwrap around
      ns = start - mlen
      ne = end - mlen
    } else {
      next = val.slice(0, start) + marker + sel + marker + val.slice(end) // wrap
      ns = start + mlen
      ne = end + mlen
    }
    onChange(next)
    setAc(null)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(ns, ne)
    })
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase()
      if (k === 'b') {
        e.preventDefault()
        return wrapSelection('**')
      }
      if (k === 'i') {
        e.preventDefault()
        return wrapSelection('*')
      }
    }
    if (!ac) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAc((a) => ({ ...a, index: (a.index + 1) % a.items.length }))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAc((a) => ({ ...a, index: (a.index - 1 + a.items.length) % a.items.length }))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      selectItem(ac.items[ac.index])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setAc(null)
    }
  }

  function onKeyUp(e) {
    // Moving the caret by keyboard pulls the view along too (only when the
    // popup isn't the one consuming the arrows).
    if (NAV_KEYS.has(e.key) && !ac) scheduleCaretFollow()
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) return
    refreshAutocomplete()
  }

  // ---- preview hover/tap preview --------------------------------------
  const [hover, setHover] = useState(null) // { kind, id, top, left, sticky }
  const hoverPool =
    hover?.kind === 'character' ? characters
    : hover?.kind === 'place' ? places
    : hover?.kind === 'region' ? regions
    : hover?.kind === 'geo' ? geoFeatures
    : []
  const hoverCard = hover ? hoverPool.find((c) => c.id === hover.id) : null

  function popoverFor(el, sticky) {
    const rect = el.getBoundingClientRect()
    setHover({
      kind: el.getAttribute('data-kind'),
      id: el.getAttribute('data-id'),
      top: rect.bottom + 6,
      left: Math.min(rect.left, window.innerWidth - 300),
      sticky,
    })
  }
  function onPreviewOver(e) {
    const el = e.target.closest?.('.hashlink.resolved[data-id]')
    if (el) popoverFor(el, false)
  }
  function onPreviewOut(e) {
    const el = e.target.closest?.('.hashlink.resolved[data-id]')
    if (el) setHover((h) => (h && h.sticky ? h : null))
  }
  function onPreviewClick(e) {
    const el = e.target.closest?.('.hashlink.resolved[data-id]')
    if (!el) return
    e.preventDefault()
    popoverFor(el, true)
  }

  // Dismiss a sticky popover on outside click.
  useEffect(() => {
    if (!hover?.sticky) return
    function onDoc(e) {
      if (popRef.current && !popRef.current.contains(e.target) && !e.target.closest?.('.hashlink')) {
        setHover(null)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [hover])

  return (
    <div className={`editor ${preview ? 'split' : ''}`}>
      <div className="editor-pane">
        <div className="format-bar">
          <button
            type="button"
            className="format-btn"
            title="Fett (Strg/Cmd+B)"
            aria-label="Fett"
            onMouseDown={(e) => {
              e.preventDefault()
              wrapSelection('**')
            }}
          >
            <Bold size={16} />
          </button>
          <button
            type="button"
            className="format-btn"
            title="Kursiv (Strg/Cmd+I)"
            aria-label="Kursiv"
            onMouseDown={(e) => {
              e.preventDefault()
              wrapSelection('*')
            }}
          >
            <Italic size={16} />
          </button>
        </div>
        <textarea
          ref={taRef}
          className="editor-textarea"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            scheduleCaretFollow() // typing + pasting keep the caret in view
            refreshAutocomplete()
          }}
          onBeforeInput={onBeforeInput}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onClick={refreshAutocomplete}
          onBlur={() => setTimeout(() => setAc(null), 150)}
          placeholder="Schreib los … tippe # für Figuren & Orte"
          spellCheck
          autoCapitalize="sentences"
        />
      </div>
      {preview && (
        // Scroll container fills the pane; the inner .editor-preview is the
        // fixed-measure page column (same width as the writing column).
        <div
          className="editor-preview-scroll"
          onMouseOver={onPreviewOver}
          onMouseOut={onPreviewOut}
          onClick={onPreviewClick}
        >
          <div className="editor-preview markdown" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      )}

      {ac && (
        <HashAutocomplete
          anchor={ac.anchor}
          items={ac.items}
          index={ac.index}
          onPick={selectItem}
          onHover={(i) => setAc((a) => (a ? { ...a, index: i } : a))}
        />
      )}

      {hover && hoverCard && (
        <div className="hash-popover" ref={popRef} style={{ top: hover.top, left: hover.left }}>
          {hover.kind === 'character' || hover.kind === 'place' ? (
            <CardPreview
              kind={hover.kind}
              card={hoverCard}
              onOpen={() => {
                openCard(hover.kind, hover.id)
                setHover(null)
              }}
            />
          ) : (
            // Compact preview for regions / geo features (no full card exists).
            <div className="entity-preview">
              <div className="entity-preview-head">
                {hover.kind === 'region' ? (
                  <span className="region-swatch" style={{ background: hoverCard.colour }} />
                ) : (
                  <Mountain size={14} />
                )}
                <b>{hoverCard.name}</b>
                <span className="entity-kind">
                  {hover.kind === 'region'
                    ? 'Region'
                    : { fluss: 'Fluss', wald: 'Wald', gebirge: 'Gebirge', see: 'See', sonstiges: 'Geografie' }[
                        hoverCard.feature_type
                      ] || 'Geografie'}
                </span>
              </div>
              {hoverCard.description && <p className="entity-preview-desc">{hoverCard.description}</p>}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  openOnMap(hover.kind, hover.id)
                  setHover(null)
                }}
              >
                <MapIcon size={12} /> Auf der Karte zeigen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// The #-name popup. Rendered in a PORTAL on <body> so no scroll container can
// clip it, then placed against the live viewport: below the caret when it
// fits, flipped ABOVE when it doesn't, clamped horizontally, and capped to the
// space available (scrolling inside itself) so entries are always readable.
// `visualViewport` is preferred where available, so the mobile keyboard counts
// as "not enough room below" and the list flips above the caret.
const AC_GAP = 6 // breathing room between the caret line and the list
const AC_MIN_HEIGHT = 96 // never squash below roughly three entries

function HashAutocomplete({ anchor, items, index, onPick, onHover }) {
  const listRef = useRef(null)
  const [pos, setPos] = useState(null) // { top, left, maxHeight, flipped }

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    const viewTop = vv ? vv.offsetTop : 0
    const viewLeft = vv ? vv.offsetLeft : 0
    const viewH = vv ? vv.height : window.innerHeight
    const viewW = vv ? vv.width : window.innerWidth
    const natural = el.scrollHeight + 2 // + borders
    const width = el.offsetWidth
    const below = viewTop + viewH - anchor.bottom - AC_GAP * 2
    const above = anchor.top - viewTop - AC_GAP * 2
    let top
    let maxHeight
    let flipped = false
    if (natural <= below || below >= above) {
      top = anchor.bottom + AC_GAP
      maxHeight = Math.max(AC_MIN_HEIGHT, below)
    } else {
      flipped = true
      maxHeight = Math.max(AC_MIN_HEIGHT, Math.min(natural, above))
      top = anchor.top - AC_GAP - maxHeight
    }
    // Keep the whole box on screen horizontally as well.
    const left = Math.max(viewLeft + AC_GAP, Math.min(anchor.left, viewLeft + viewW - width - AC_GAP))
    setPos({ top: Math.max(viewTop + AC_GAP, top), left, maxHeight, flipped })
  }, [anchor.top, anchor.bottom, anchor.left, items.length])

  // Keep the highlighted entry visible when the list has to scroll.
  useLayoutEffect(() => {
    listRef.current?.children?.[index]?.scrollIntoView({ block: 'nearest' })
  }, [index, pos])

  return createPortal(
    <ul
      ref={listRef}
      className={`hash-ac ${pos?.flipped ? 'flipped' : ''}`}
      style={
        pos
          ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight }
          : // First pass measures the natural height off-screen-ish; useLayoutEffect
            // places it before the browser paints, so this is never seen.
            { top: anchor.bottom + AC_GAP, left: anchor.left, visibility: 'hidden' }
      }
    >
      {items.map((it, i) => (
        <li
          key={it.kind + it.id + (it.alias || '')}
          className={`hash-ac-item ${i === index ? 'active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(it)
          }}
          onMouseEnter={() => onHover(i)}
        >
          <span className={`hash-ac-icon kind-${it.kind}`}>
            {(() => {
              const Icon = KIND_ICONS[it.kind] || MapPin
              return <Icon size={15} />
            })()}
          </span>
          <span className="hash-ac-name">
            {it.alias ? (
              <>
                {it.alias} <span className="hash-ac-main">— {it.name}</span>
              </>
            ) : (
              it.name
            )}
          </span>
          {!it.name_final && <span className="badge provisional small">prov.</span>}
        </li>
      ))}
    </ul>,
    document.body,
  )
}
