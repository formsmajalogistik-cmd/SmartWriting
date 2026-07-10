import { useEffect, useMemo, useRef, useState } from 'react'
import { Marked } from 'marked'
import { Bold, Italic, User, MapPin, Flag, Mountain, Map as MapIcon } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { makeResolver, hashlinkExtension } from '../lib/hashlinks.js'
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

export default function Editor({ value, onChange, preview, focusSelection, onFocusApplied }) {
  const { characters, places, regions, geoFeatures, openCard, openOnMap, editorGuillemets } = useStore()
  const taRef = useRef(null)
  const popRef = useRef(null)

  // Jump-to-match from manuscript search: focus the textarea and select the
  // match range (which scrolls it into view), then clear the pending request.
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
      onFocusApplied?.()
    })
    return () => cancelAnimationFrame(id)
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
    const all = [
      ...characters.map((c) => ({ id: c.id, name: c.name, kind: 'character', name_final: c.name_final })),
      ...places.map((p) => ({ id: p.id, name: p.name, kind: 'place', name_final: p.name_final })),
      ...regions.map((r) => ({ id: r.id, name: r.name, kind: 'region', name_final: true })),
      ...geoFeatures.map((g) => ({ id: g.id, name: g.name, kind: 'geo', name_final: true })),
    ].filter((o) => o.name && o.name.toLowerCase().includes(q))
    all.sort((a, b) => {
      const as = a.name.toLowerCase().startsWith(q) ? 0 : 1
      const bs = b.name.toLowerCase().startsWith(q) ? 0 : 1
      return as - bs || a.name.localeCompare(b.name)
    })
    const items = all.slice(0, 8)
    if (!items.length) return setAc(null)
    const coords = getCaretCoordinates(ta, caret)
    const rect = ta.getBoundingClientRect()
    setAc({
      items,
      index: 0,
      top: rect.top + coords.top - ta.scrollTop + coords.height,
      left: rect.left + coords.left - ta.scrollLeft,
      tokenStart,
      caret,
    })
  }

  function selectItem(item) {
    const ta = taRef.current
    if (!ta || !ac) return
    const before = ta.value.slice(0, ac.tokenStart)
    const after = ta.value.slice(ac.caret)
    const inserted = before + '#' + item.name
    onChange(inserted + after)
    setAc(null)
    const pos = inserted.length
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(pos, pos)
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
        <div
          className="editor-preview markdown"
          onMouseOver={onPreviewOver}
          onMouseOut={onPreviewOut}
          onClick={onPreviewClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}

      {ac && (
        <ul className="hash-ac" style={{ top: ac.top, left: ac.left }}>
          {ac.items.map((it, i) => (
            <li
              key={it.kind + it.id}
              className={`hash-ac-item ${i === ac.index ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                selectItem(it)
              }}
              onMouseEnter={() => setAc((a) => ({ ...a, index: i }))}
            >
              <span className={`hash-ac-icon kind-${it.kind}`}>
                {(() => {
                  const Icon = KIND_ICONS[it.kind] || MapPin
                  return <Icon size={15} />
                })()}
              </span>
              <span className="hash-ac-name">{it.name}</span>
              {!it.name_final && <span className="badge provisional small">prov.</span>}
            </li>
          ))}
        </ul>
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
