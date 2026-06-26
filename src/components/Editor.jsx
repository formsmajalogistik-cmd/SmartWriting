import { useEffect, useMemo, useRef, useState } from 'react'
import { Marked } from 'marked'
import { useStore } from '../state/store.jsx'
import { makeResolver, hashlinkExtension } from '../lib/hashlinks.js'
import { getCaretCoordinates } from '../lib/caret.js'
import CardPreview from './CardPreview.jsx'

// Distraction-light Markdown editor with #Name linking.
// - Typing "#…" opens an autocomplete over character + place cards; selecting
//   inserts the literal "#Name" into the Markdown (no hidden ids).
// - The preview pane renders #Name tokens as resolved / provisional / unresolved
//   links; hovering or tapping a resolved link shows a compact card preview.
const PARTIAL_RE = /#([\p{L}\p{N}_'’\-]*)$/u
const NAME_CHAR = /[\p{L}\p{N}]/u

export default function Editor({ value, onChange, preview }) {
  const { characters, places, openCard } = useStore()
  const taRef = useRef(null)
  const popRef = useRef(null)

  const resolver = useMemo(() => makeResolver(characters, places), [characters, places])

  const html = useMemo(() => {
    if (!preview) return ''
    const m = new Marked({ breaks: true })
    m.use(hashlinkExtension(resolver))
    return m.parse(value || '')
  }, [preview, value, resolver])

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

  function onKeyDown(e) {
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
  const hoverCard = hover
    ? (hover.kind === 'character' ? characters : places).find((c) => c.id === hover.id)
    : null

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
      <textarea
        ref={taRef}
        className="editor-textarea"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          refreshAutocomplete()
        }}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onClick={refreshAutocomplete}
        onBlur={() => setTimeout(() => setAc(null), 150)}
        placeholder="Schreib los … tippe # für Figuren & Orte"
        spellCheck
        autoCapitalize="sentences"
      />
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
              <span className="hash-ac-icon">{it.kind === 'character' ? '👤' : '📍'}</span>
              <span className="hash-ac-name">{it.name}</span>
              {!it.name_final && <span className="badge provisional small">prov.</span>}
            </li>
          ))}
        </ul>
      )}

      {hover && hoverCard && (
        <div className="hash-popover" ref={popRef} style={{ top: hover.top, left: hover.left }}>
          <CardPreview
            kind={hover.kind}
            card={hoverCard}
            onOpen={() => {
              openCard(hover.kind, hover.id)
              setHover(null)
            }}
          />
        </div>
      )}
    </div>
  )
}
