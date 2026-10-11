import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, EyeOff, Flag, MapPin, Plus, Trash2, User, X, Zap } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import AddCombo from './AddCombo.jsx'
import {
  PRECISIONS,
  PRECISION_LABELS,
  VISIBILITIES,
  VISIBILITY_LABELS,
  assignLanes,
  bookStarts,
  compactOffset,
  describeEntryDate,
  entryEnd,
  entryStart,
  eraBands,
  eraLabels,
  filterEntries,
  fuzzyRange,
  isSpan,
  overviewScale,
  storyScale,
  storyWindow,
} from '../lib/chronik.js'

// CHRONIK — the in-universe timeline: dated world history relative to the
// start of Book 1 (Jahr 0). Two scales, because deep history must never squash
// the trilogy's own years into one point:
//   • Übersicht  — a symmetric logarithmic axis (1, 10, 100, 1000 years from
//                  Book 1 equally far apart): everything at once;
//   • Erzählzeit — a linear axis over the story's own years; earlier/later
//                  entries are counted at the edges.
// Point entries are markers, spans bars, eras bands, fuzzy dates show their
// uncertainty. Below the axis: the same entries as a chronological list.
export default function ChronikView() {
  const {
    timelineEntries,
    events,
    characters,
    places,
    regions,
    activeProject,
    bookYearOffsets,
    openCard,
    openOnMap,
  } = useStore()
  const books = activeProject?.settings?.books ?? []
  const starts = useMemo(() => bookStarts(books, bookYearOffsets), [books, bookYearOffsets])

  const [filters, setFilters] = useState({ era: '', characterId: '', placeId: '', regionId: '', visibility: '' })
  const [scaleMode, setScaleMode] = useState('overview')
  const [editing, setEditing] = useState(null) // entry id | 'new' | null
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const filtered = useMemo(
    () => filterEntries(timelineEntries, filters, { events, places }),
    [timelineEntries, filters, events, places],
  )
  const eras = useMemo(() => eraLabels(timelineEntries), [timelineEntries])
  const anyFilter = Object.values(filters).some(Boolean)
  const nameOf = (list, id) => list.find((x) => x.id === id)?.name || null

  // Filter options: only what entries actually link (incl. through events).
  const linked = useMemo(() => {
    const all = filterEntries(timelineEntries, {}, { events, places })
    const pick = (key, list) => {
      const ids = new Set(all.flatMap((v) => v[key]))
      return list.filter((x) => ids.has(x.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'))
    }
    return { characters: pick('characterIds', characters), places: pick('placeIds', places), regions: pick('regionIds', regions) }
  }, [timelineEntries, events, places, characters, regions])

  const editEntry = editing && editing !== 'new' ? timelineEntries.find((e) => e.id === editing) : null

  return (
    <div className="chronik-view">
      <div className="chronik-head">
        <h2>Chronik</h2>
        <span className="hint">Jahre relativ zum Beginn von Buch 1 (Jahr 0)</span>
        <button className="toggle primary with-label" onClick={() => setEditing('new')}>
          <Plus size={15} /> Eintrag
        </button>
      </div>

      <div className="chronik-bar">
        <nav className="seg" aria-label="Maßstab">
          <button className={`seg-btn ${scaleMode === 'overview' ? 'on' : ''}`} onClick={() => setScaleMode('overview')}>
            Übersicht
          </button>
          <button className={`seg-btn ${scaleMode === 'story' ? 'on' : ''}`} onClick={() => setScaleMode('story')}>
            Erzählzeit
          </button>
        </nav>
        <select value={filters.era} onChange={(e) => setFilter('era', e.target.value)} aria-label="Epoche">
          <option value="">Alle Epochen</option>
          {eras.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>
        <select value={filters.characterId} onChange={(e) => setFilter('characterId', e.target.value)} aria-label="Figur">
          <option value="">Alle Figuren</option>
          {linked.characters.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={filters.placeId} onChange={(e) => setFilter('placeId', e.target.value)} aria-label="Ort">
          <option value="">Alle Orte</option>
          {linked.places.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select value={filters.regionId} onChange={(e) => setFilter('regionId', e.target.value)} aria-label="Region">
          <option value="">Alle Regionen</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <select value={filters.visibility} onChange={(e) => setFilter('visibility', e.target.value)} aria-label="Sichtbarkeit">
          <option value="">Öffentlich & verborgen</option>
          {VISIBILITIES.map((v) => (
            <option key={v} value={v}>{VISIBILITY_LABELS[v]}</option>
          ))}
        </select>
        {anyFilter && (
          <button className="toggle" onClick={() => setFilters({ era: '', characterId: '', placeId: '', regionId: '', visibility: '' })}>
            Filter zurücksetzen
          </button>
        )}
        <span className="chronik-count">
          {filtered.length} von {timelineEntries.length} Einträgen
        </span>
      </div>

      {timelineEntries.length > 0 && (
        <ChronikAxis
          views={filtered}
          allEntries={timelineEntries}
          starts={starts}
          mode={scaleMode}
          onSelect={setEditing}
          selectedId={editing}
        />
      )}

      <BookStartsEditor starts={starts} />

      <div className="chronik-body">
        {timelineEntries.length === 0 ? (
          <p className="hint chronik-empty">
            Noch keine Einträge. Lege mit „Eintrag“ das erste Stück Weltgeschichte an — ein Ereignis aus
            den Kapiteln lässt sich verknüpfen statt kopieren.
          </p>
        ) : (
          <ChronikList
            views={filtered}
            starts={starts}
            selectedId={editing}
            onSelect={setEditing}
            nameOf={nameOf}
            characters={characters}
            places={places}
            regions={regions}
            openCard={openCard}
            openOnMap={openOnMap}
          />
        )}
        {editing && (
          <EntryEditor
            key={editing}
            entry={editEntry}
            eras={eras}
            onClose={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  )
}

// ---- the axis ---------------------------------------------------------------
const PAD = 48
const BAND_H = 18
const LANE_H = 26
const AXIS_GAP = 30

function ChronikAxis({ views, allEntries, starts, mode, onSelect, selectedId }) {
  const ref = useRef(null)
  const [width, setWidth] = useState(1000)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => setWidth(Math.max(320, Math.round(el.getBoundingClientRect().width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const entries = views.map((v) => v.entry)
  const placedStarts = useMemo(() => starts.filter((s) => s.offset != null), [starts])
  const scale = useMemo(() => {
    if (mode === 'story') return storyScale(storyWindow(starts, allEntries), width, PAD)
    const years = [0, ...placedStarts.map((s) => s.offset)]
    for (const e of allEntries) years.push(...fuzzyRange(e), entryStart(e), entryEnd(e))
    return overviewScale(years, width, PAD)
  }, [mode, starts, allEntries, width, placedStarts])
  const [lo, hi] = scale.domain
  const inWindow = (e) => mode !== 'story' || (entryEnd(e) >= lo && entryStart(e) <= hi)
  const earlier = mode === 'story' ? entries.filter((e) => entryEnd(e) < lo).length : 0
  const later = mode === 'story' ? entries.filter((e) => entryStart(e) > hi).length : 0
  const clampX = (year) => Math.max(PAD - 6, Math.min(width - PAD + 6, scale.x(year)))

  // Eras as bands (lane-packed so overlapping eras stay readable).
  const bands = eraBands(entries).filter((b) => mode !== 'story' || (b.end >= lo && b.start <= hi))
  const bandLanes = assignLanes(bands.map((b) => ({ id: b.label, x1: clampX(b.start), x2: Math.max(clampX(b.end), clampX(b.start) + 8 * b.label.length + 12) })), 4)
  const bandsH = bandLanes.count * BAND_H
  const axisY = bandsH + AXIS_GAP

  // Entries in lanes below the axis; the label's width counts so labels never overlap.
  const visible = views.filter((v) => inWindow(v.entry))
  const items = visible.map((v) => {
    const e = v.entry
    const [flo, fhi] = fuzzyRange(e)
    const x1 = clampX(Math.min(flo, entryStart(e)))
    const xEnd = clampX(Math.max(fhi, entryEnd(e)))
    const label = v.title.length > 26 ? `${v.title.slice(0, 25)}…` : v.title
    return { v, label, x1: x1 - 6, x2: Math.max(xEnd, clampX(entryStart(e)) + 10 + label.length * 6.6) }
  })
  const { lanes, count } = assignLanes(items.map((it) => ({ id: it.v.entry.id, x1: it.x1, x2: it.x2 })))
  const height = axisY + 18 + Math.max(1, count) * LANE_H + 10

  return (
    <div className="chronik-axis" ref={ref}>
      <svg width="100%" height={height} role="img" aria-label="Zeitachse der Chronik">
        {/* era bands */}
        {bands.map((b) => {
          const lane = bandLanes.lanes.get(b.label)
          const x1 = clampX(b.start)
          const x2 = Math.max(clampX(b.end), x1 + 3)
          return (
            <g key={b.label} className="ch-band">
              <rect x={x1} y={lane * BAND_H + 4} width={x2 - x1} height={BAND_H - 4} rx={3} />
              <text x={x1 + 4} y={lane * BAND_H + 15}>{b.label}</text>
            </g>
          )
        })}

        {/* the axis with its ticks */}
        <line className="ch-axis-line" x1={PAD - 10} x2={width - PAD + 10} y1={axisY} y2={axisY} />
        {scale.ticks.map((t) => (
          <g key={t} className="ch-tick" transform={`translate(${scale.x(t)} ${axisY})`}>
            <line y1={-4} y2={4} />
            {t !== 0 && <text y={-8} textAnchor="middle">{compactOffset(t)}</text>}
          </g>
        ))}

        {/* where the books begin; Jahr 0 = Beginn Buch 1 */}
        {placedStarts
          .filter((s) => mode !== 'story' || (s.offset >= lo && s.offset <= hi))
          .map((s) => (
            <g key={s.id} className={`ch-book ${s.index === 0 ? 'zero' : ''}`} transform={`translate(${scale.x(s.offset)} 0)`}>
              <line y1={bandsH + 6} y2={height - 4} />
              <text y={bandsH + 16} x={4}>
                {s.index === 0 ? `Jahr 0 · Beginn ${s.title}` : `${s.title} · ${compactOffset(s.offset)}`}
              </text>
            </g>
          ))}
        {placedStarts.length === 0 && (
          <g className="ch-book zero" transform={`translate(${scale.x(0)} 0)`}>
            <line y1={bandsH + 6} y2={height - 4} />
            <text y={bandsH + 16} x={4}>Jahr 0 · Beginn Buch 1</text>
          </g>
        )}

        {/* entries: markers, span bars, fuzzy ranges */}
        {items.map((it) => {
          const e = it.v.entry
          const y = axisY + 22 + lanes.get(e.id) * LANE_H
          const x = clampX(entryStart(e))
          const [flo, fhi] = fuzzyRange(e)
          const cls = [
            'ch-entry',
            isSpan(e) ? 'span' : 'point',
            e.year_precision !== 'exakt' ? 'fuzzy' : '',
            e.visibility === 'verborgen' ? 'hidden-entry' : '',
            selectedId === e.id ? 'selected' : '',
          ].join(' ')
          return (
            <g
              key={e.id}
              className={cls}
              data-entry-id={e.id}
              onClick={() => onSelect(e.id)}
              tabIndex={0}
              role="button"
              onKeyDown={(ev) => ev.key === 'Enter' && onSelect(e.id)}
            >
              <title>{`${it.v.title} — ${describeEntryDate(e)}`}</title>
              {flo !== fhi && <rect className="ch-fuzz" x={clampX(flo)} y={y - 6} width={Math.max(2, clampX(fhi) - clampX(flo))} height={12} rx={6} />}
              {isSpan(e) ? (
                <rect className="ch-bar" x={x} y={y - 5} width={Math.max(4, clampX(entryEnd(e)) - x)} height={10} rx={3} />
              ) : (
                <circle className="ch-dot" cx={x} cy={y} r={5.5} />
              )}
              <text className="ch-label" x={x + (isSpan(e) ? 4 : 10)} y={isSpan(e) ? y - 8 : y + 4}>
                {it.label}
              </text>
            </g>
          )
        })}

        {earlier > 0 && (
          <text className="ch-edge" x={4} y={axisY + 18}>← {earlier} früher</text>
        )}
        {later > 0 && (
          <text className="ch-edge" x={width - 4} y={axisY + 18} textAnchor="end">{later} später →</text>
        )}
      </svg>
      <p className="hint chronik-legend">
        {mode === 'overview'
          ? 'Übersicht: logarithmisch gestaucht — 1, 10, 100, 1000 Jahre vor/nach Buch 1 liegen gleich weit auseinander, so bleiben die Jahre der Handlung lesbar.'
          : 'Erzählzeit: linear über die Jahre der Handlung; frühere und spätere Einträge werden am Rand gezählt.'}{' '}
        Punkt = Zeitpunkt, Balken = Zeitspanne, Band = Epoche, Schleier = unscharfe Datierung, gestrichelt = verborgen.
      </p>
    </div>
  )
}

// ---- where the books begin -------------------------------------------------
function BookStartsEditor({ starts }) {
  const { setBookYearOffset } = useStore()
  if (!starts.length) return null
  return (
    <details className="chronik-books">
      <summary>
        <BookOpen size={14} /> Buchanfänge auf der Zeitachse
      </summary>
      <ul>
        {starts.map((s) => (
          <li key={s.id}>
            <span className="cb-title">{s.title}</span>
            {s.fixed ? (
              <span className="hint">Jahr 0 (fest — alle Jahre zählen ab hier)</span>
            ) : (
              <label className="cb-offset">
                <span>beginnt im Jahr</span>
                <input
                  key={`${s.id}:${s.offset ?? ''}`}
                  type="number"
                  step={1}
                  defaultValue={s.offset ?? ''}
                  placeholder="—"
                  aria-label={`Beginn von ${s.title} (Jahre nach Buch 1)`}
                  onBlur={(e) => {
                    const v = e.target.value
                    if (String(v) !== String(s.offset ?? '')) setBookYearOffset(s.id, v)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
              </label>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

// ---- chronological list ----------------------------------------------------
function ChronikList({ views, starts, selectedId, onSelect, nameOf, characters, places, regions, openCard, openOnMap }) {
  // Interleave the book starts (and Jahr 0) as milestones.
  const rows = []
  const milestones = starts.filter((s) => s.offset != null).sort((a, b) => a.offset - b.offset || a.index - b.index)
  if (!milestones.length) milestones.push({ id: 'zero', title: 'Buch 1', index: 0, offset: 0 })
  let m = 0
  for (const v of views) {
    while (m < milestones.length && milestones[m].offset <= entryStart(v.entry)) rows.push({ milestone: milestones[m++] })
    rows.push({ v })
  }
  while (m < milestones.length) rows.push({ milestone: milestones[m++] })

  return (
    <ol className="chronik-list">
      {rows.map((r) =>
        r.milestone ? (
          <li key={`m-${r.milestone.id}`} className={`chronik-milestone ${r.milestone.index === 0 ? 'zero' : ''}`}>
            <span className="cl-offset">{compactOffset(r.milestone.offset)}</span>
            <span className="cl-milestone-text">
              {r.milestone.index === 0 ? `Beginn ${r.milestone.title} — Jahr 0` : `Beginn ${r.milestone.title}`}
            </span>
          </li>
        ) : (
          <li
            key={r.v.entry.id}
            className={`chronik-row ${selectedId === r.v.entry.id ? 'selected' : ''} ${r.v.entry.visibility === 'verborgen' ? 'hidden-entry' : ''}`}
          >
            <span className="cl-offset">{compactOffset(r.v.entry.year_offset, r.v.entry.year_precision)}</span>
            <div className="cl-main">
              <button type="button" className="cl-title" onClick={() => onSelect(r.v.entry.id)} title="Bearbeiten">
                {r.v.title}
              </button>
              <span className="cl-date">{describeEntryDate(r.v.entry)}</span>
              {r.v.description && <p className="cl-desc">{r.v.description}</p>}
              <span className="cl-chips">
                {r.v.entry.era_label && <span className="badge small">{r.v.entry.era_label}</span>}
                {r.v.entry.visibility === 'verborgen' && (
                  <span className="badge small cl-hidden"><EyeOff size={11} /> verborgen</span>
                )}
                {r.v.event && (
                  <button type="button" className="names-chip" onClick={() => openCard('event', r.v.event.id)} title="Ereignis öffnen">
                    <Zap size={11} /> {r.v.event.title}
                  </button>
                )}
                {r.v.eventMissing && <span className="badge small">Ereignis gelöscht</span>}
                {r.v.characterIds.map((id) => nameOf(characters, id) && (
                  <button key={id} type="button" className="names-chip" onClick={() => openCard('character', id)} title="Figur öffnen">
                    <User size={11} /> {nameOf(characters, id)}
                  </button>
                ))}
                {r.v.placeIds.map((id) => nameOf(places, id) && (
                  <button key={id} type="button" className="names-chip" onClick={() => openCard('place', id)} title="Ort öffnen">
                    <MapPin size={11} /> {nameOf(places, id)}
                  </button>
                ))}
                {r.v.regionIds.map((id) => nameOf(regions, id) && (
                  <button key={id} type="button" className="names-chip" onClick={() => openOnMap('region', id)} title="Region auf der Karte zeigen">
                    <Flag size={11} /> {nameOf(regions, id)}
                  </button>
                ))}
              </span>
            </div>
          </li>
        ),
      )}
    </ol>
  )
}

// ---- add / edit one entry ---------------------------------------------------
function EntryEditor({ entry, eras, onClose }) {
  const { events, characters, places, regions, createTimelineEntry, updateTimelineEntry, deleteTimelineEntry, openCard } = useStore()
  const [d, setD] = useState(() => ({
    title: entry?.title || '',
    description: entry?.description || '',
    year_offset: entry ? String(entry.year_offset ?? 0) : '',
    year_precision: entry?.year_precision || 'exakt',
    duration_years: entry?.duration_years != null ? String(entry.duration_years) : '',
    era_label: entry?.era_label || '',
    visibility: entry?.visibility || 'oeffentlich',
    event_id: entry?.event_id || '',
    related_character_ids: entry?.related_character_ids || [],
    related_place_ids: entry?.related_place_ids || [],
    related_region_ids: entry?.related_region_ids || [],
  }))
  const [msg, setMsg] = useState(null)
  const set = (k, v) => setD((cur) => ({ ...cur, [k]: v }))
  // On narrow screens the editor sits above the list — bring it into view.
  const formRef = useRef(null)
  useEffect(() => {
    formRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])
  const ev = d.event_id ? events.find((e) => e.id === d.event_id) : null

  async function save(e) {
    e.preventDefault()
    if (d.year_offset === '' || !Number.isFinite(Number(d.year_offset))) return setMsg('Bitte ein Jahr angeben (relativ zu Buch 1, z. B. -312, 0 oder 4).')
    if (!ev && !d.title.trim()) return setMsg('Bitte einen Titel angeben — oder ein Ereignis verknüpfen.')
    // Linked to an event: the EVENT stays the source of title & description.
    // Its title is kept only as a fallback label, should the event be deleted
    // one day (the entry then keeps its dating and stays readable).
    const patch = { ...d, title: ev ? d.title.trim() || ev.title || '' : d.title.trim() }
    try {
      if (entry) await updateTimelineEntry(entry.id, patch)
      else await createTimelineEntry(patch)
      onClose()
    } catch (err) {
      setMsg(err?.message || 'Konnte nicht gespeichert werden.')
    }
  }

  const listPicker = (label, Icon, list, field) => {
    const chosen = d[field]
    return (
      <div className="field ce-links">
        <span>{label}</span>
        <AddCombo
          placeholder={`${label} hinzufügen …`}
          options={list.filter((x) => !chosen.includes(x.id))}
          onPick={(id) => set(field, [...chosen, id])}
        />
        {chosen.length > 0 && (
          <ul className="chip-list">
            {chosen.map((id) => (
              <li key={id} className="chip">
                <span><Icon size={11} /> {list.find((x) => x.id === id)?.name || '(gelöscht)'}</span>
                <button type="button" className="chip-remove" title="Entfernen" onClick={() => set(field, chosen.filter((x) => x !== id))}>
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <form ref={formRef} className="chronik-editor" onSubmit={save} aria-label={entry ? 'Chronik-Eintrag bearbeiten' : 'Neuer Chronik-Eintrag'}>
      <div className="ce-head">
        <h3>{entry ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}</h3>
        <button type="button" className="icon-btn" title="Schließen" aria-label="Schließen" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <label className="field">
        <span>Ereignis verknüpfen (statt kopieren)</span>
        <select value={d.event_id} onChange={(e) => set('event_id', e.target.value)}>
          <option value="">— kein Ereignis: eigener Eintrag —</option>
          {events.map((x) => (
            <option key={x.id} value={x.id}>{x.title}</option>
          ))}
        </select>
      </label>

      {ev ? (
        <div className="ce-event">
          <b>{ev.title}</b>
          {ev.card?.description && <p>{ev.card.description}</p>}
          <p className="hint">Titel, Beschreibung, beteiligte Figuren und Ort kommen aus dem Ereignis — eine Quelle, keine Kopie.</p>
          <button type="button" className="toggle" onClick={() => openCard('event', ev.id)}>
            <Zap size={13} /> Ereignis öffnen
          </button>
        </div>
      ) : (
        <>
          <label className="field">
            <span>Titel</span>
            <input value={d.title} onChange={(e) => set('title', e.target.value)} placeholder="z. B. Gründung von Porsiran" autoFocus />
          </label>
          <label className="field">
            <span>Beschreibung</span>
            <textarea rows={3} value={d.description} onChange={(e) => set('description', e.target.value)} />
          </label>
        </>
      )}

      <div className="ce-row">
        <label className="field">
          <span>Jahr (relativ zu Buch 1)</span>
          <input type="number" step={1} value={d.year_offset} onChange={(e) => set('year_offset', e.target.value)} placeholder="-312 · 0 · 4" />
        </label>
        <label className="field">
          <span>Genauigkeit</span>
          <select value={d.year_precision} onChange={(e) => set('year_precision', e.target.value)}>
            {PRECISIONS.map((p) => (
              <option key={p} value={p}>{PRECISION_LABELS[p]}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Dauer in Jahren (optional)</span>
          <input type="number" min={0} step={1} value={d.duration_years} onChange={(e) => set('duration_years', e.target.value)} placeholder="leer = Zeitpunkt" />
        </label>
      </div>
      {d.year_offset !== '' && Number.isFinite(Number(d.year_offset)) && (
        <p className="hint ce-preview">
          → {describeEntryDate({ year_offset: Number(d.year_offset), year_precision: d.year_precision, duration_years: d.duration_years === '' ? null : Number(d.duration_years) })}
        </p>
      )}

      <div className="ce-row">
        <label className="field">
          <span>Epoche / Ära</span>
          <input value={d.era_label} onChange={(e) => set('era_label', e.target.value)} list="chronik-eras" placeholder="optional" />
          <datalist id="chronik-eras">
            {eras.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Sichtbarkeit</span>
          <select value={d.visibility} onChange={(e) => set('visibility', e.target.value)}>
            {VISIBILITIES.map((v) => (
              <option key={v} value={v}>{VISIBILITY_LABELS[v]}</option>
            ))}
          </select>
        </label>
      </div>

      {listPicker('Figuren', User, characters, 'related_character_ids')}
      {listPicker('Orte', MapPin, places, 'related_place_ids')}
      {listPicker('Regionen', Flag, regions, 'related_region_ids')}

      {msg && <p className="hint ce-msg">{msg}</p>}
      <div className="ce-actions">
        <button type="submit" className="toggle primary">Speichern</button>
        <button type="button" className="toggle" onClick={onClose}>Abbrechen</button>
        {entry && (
          <button
            type="button"
            className="icon-btn danger ce-delete"
            title="Eintrag löschen"
            aria-label="Eintrag löschen"
            onClick={async () => {
              if (window.confirm('Diesen Chronik-Eintrag löschen?')) {
                await deleteTimelineEntry(entry.id)
                onClose()
              }
            }}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </form>
  )
}
