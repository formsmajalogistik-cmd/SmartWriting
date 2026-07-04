import { useMemo, useRef, useState } from 'react'
import {
  Copy,
  Check,
  Search,
  ChevronDown,
  ChevronRight,
  X,
  AlertTriangle,
  Flame,
  BookMarked,
  Hammer,
  Plus,
  Download,
  Upload,
  Trash2,
} from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { useLexicon, baseLexicon } from '../lib/praemali/useLexicon.js'
import { searchLexicon, disambiguationFor, findRootCollision } from '../lib/praemali/lexicon.js'
import {
  assembleSentence,
  generateForms,
  nounClassFor,
  DIVINE_REGISTERS,
} from '../lib/praemali/engine.js'
import { canonicalPhrases } from '../lib/praemali/phrases.js'

// The Praemali translator: dictionary lookup, guided sentence builder, phrase
// library and custom-word editor. Data-driven — every word comes from the
// merged lexicon (bundled base JSON + the user's synced custom entries).
// NOTE: this feature's UI is intentionally English (per the translator spec);
// lookup accepts German and English input equally.

const REGISTERS = ['common', 'sacred', 'proto-divine']

function CopyBtn({ text, small }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={`pr-copy ${small ? 'sm' : ''} ${done ? 'done' : ''}`}
      title="Copy Praemali"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        } catch {
          /* clipboard denied — nothing to break */
        }
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

function RegisterBadge({ register }) {
  const r = register || 'all'
  return <span className={`pr-reg pr-reg-${r.replace(/[^a-z]/g, '')}`}>{r}</span>
}

// Full derivation table for one root, expandable inline in lookup results.
function DerivationTable({ root }) {
  return (
    <div className="pr-derivation">
      <div className="pr-derivation-meta">
        <b>{root.root}</b> — {root.meaning} <RegisterBadge register={root.register} />
        {root.god_connection && <span className="pr-god">✦ {root.god_connection}</span>}
        {root.note && <div className="pr-note">{root.note}</div>}
      </div>
      <table className="pr-table">
        <tbody>
          {Object.entries(root.forms || {}).map(([ft, form]) => (
            <tr key={ft}>
              <td className="pr-ft">{ft.replace(/_/g, ' ')}</td>
              <td className="pr-form">{form}</td>
              <td><CopyBtn text={form} small /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- Lookup -----------------------------------------------------------------
function LookupView({ lexicon }) {
  const [query, setQuery] = useState('')
  const [lang, setLang] = useState('en')
  const [openRoot, setOpenRoot] = useState(null)

  const results = useMemo(() => searchLexicon(lexicon, query, lang), [lexicon, query, lang])
  const disambig = useMemo(() => disambiguationFor(lexicon, query), [lexicon, query])

  return (
    <div className="pr-pane">
      <div className="pr-search-row">
        <div className="search-box pr-search">
          <Search size={15} />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the lexicon …"
            aria-label="Search the Praemali lexicon"
          />
        </div>
        <div className="seg" role="group" aria-label="Search language">
          {[['en', 'EN'], ['de', 'DE'], ['pr', 'Praemali']].map(([k, label]) => (
            <button key={k} className={`seg-btn ${lang === k ? 'on' : ''}`} onClick={() => setLang(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {disambig && (
        <div className="pr-disambig">
          <b>„{disambig.term}" has several senses — never guessed for you:</b>
          <ul>
            {Object.entries(disambig.options).map(([sense, note]) => (
              <li key={sense}>
                <span className="pr-sense">{sense.replace(/_/g, ' ')}:</span> {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!query.trim() ? (
        <p className="hint">Type an English, German or Praemali word. Fuzzy matching is on — close misses still find their word.</p>
      ) : results.length === 0 ? (
        <p className="hint">No match for “{query.trim()}”.</p>
      ) : (
        <ul className="pr-results">
          {results.map((r) => (
            <li key={r.term} className="pr-result">
              <div className="pr-term">
                {r.term}
                {r.rank === 2 && <span className="pr-fuzzy">≈ fuzzy</span>}
              </div>
              {r.matches.map((m, i) => {
                const root = m.root ? lexicon.rootsByKey.get(m.root) : null
                const key = `${r.term}-${i}`
                return (
                  <div key={key} className="pr-match">
                    <span className="pr-form big">{m.form}</span>
                    <CopyBtn text={m.form} small />
                    {root ? (
                      <button
                        type="button"
                        className="pr-root-chip"
                        onClick={() => setOpenRoot(openRoot === key ? null : key)}
                        title="Show full derivation table"
                      >
                        {openRoot === key ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {m.root}
                      </button>
                    ) : (
                      <span className="pr-kind">{m.kind}{m.group ? ` · ${m.group}` : ''}</span>
                    )}
                    {m.formType && <span className="pr-kind">{m.formType.replace(/_/g, ' ')}</span>}
                    <RegisterBadge register={m.register} />
                    {m.note && <span className="pr-inline-note" title={m.note}>ⓘ</span>}
                    {openRoot === key && root && <DerivationTable root={root} />}
                  </div>
                )
              })}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---- generic slot picker -------------------------------------------------------
function SlotPicker({ label, optional, value, options, onPick, onClear, render }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim()
    const list = needle
      ? options.filter((o) => `${o.gloss} ${o.form}`.toLowerCase().includes(needle))
      : options
    return list.slice(0, 60)
  }, [options, q])
  return (
    <div className={`pr-slot ${value ? 'filled' : ''}`}>
      <span className="pr-slot-label">{label}{optional ? '?' : ''}</span>
      <button type="button" className="pr-slot-value" onClick={() => setOpen((v) => !v)}>
        {value ? (render ? render(value) : value.form) : '—'}
      </button>
      {value && onClear && (
        <button type="button" className="pr-slot-clear" onClick={onClear} aria-label={`Clear ${label}`}>
          <X size={11} />
        </button>
      )}
      {open && (
        <div className="pr-picker">
          <input
            autoFocus
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${label.toLowerCase()} …`}
          />
          <ul>
            {filtered.map((o, i) => (
              <li key={`${o.form}-${i}`}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(o)
                    setOpen(false)
                    setQ('')
                  }}
                >
                  <b>{o.form}</b> <span>{o.gloss}</span>
                  {o.register && o.register !== 'all' && <RegisterBadge register={o.register} />}
                </button>
              </li>
            ))}
            {!filtered.length && <li className="pr-picker-empty">No match.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

// ---- Builder --------------------------------------------------------------------
function BuilderView({ lexicon }) {
  const { createSavedPhrase, createCustomLexicon } = useStore()
  const [register, setRegister] = useState('common')
  const [mode, setMode] = useState('action')
  const [aspect, setAspect] = useState('imperfective')
  const [slots, setSlots] = useState({})
  const [saveMsg, setSaveMsg] = useState(null)
  const set = (k, v) => setSlots((s) => ({ ...s, [k]: v }))

  // ---- option pools (derived from the merged lexicon) ----
  const pools = useMemo(() => {
    const nouns = []
    const verbs = []
    const adjectives = []
    for (const r of lexicon.roots) {
      const f = r.forms || {}
      const g = (r.meaning || '').split(',')[0].trim()
      if (f.noun) nouns.push({ form: f.noun, gloss: g, rootKey: r.root, formType: 'noun', register: r.register, rootEntry: r })
      if (f.agent) nouns.push({ form: f.agent, gloss: `${g} (person)`, rootKey: r.root, formType: 'agent', register: r.register, rootEntry: r })
      if (f.plural) nouns.push({ form: f.plural, gloss: `${g} (plural)`, rootKey: r.root, formType: 'plural', register: r.register, rootEntry: r })
      if (f.perfective || f.imperfective) verbs.push({ form: f.imperfective || f.perfective, gloss: g, rootKey: r.root, register: r.register, rootEntry: r })
      if (f.adjective) adjectives.push({ form: f.adjective, gloss: g, rootKey: r.root, register: r.register, rootEntry: r })
    }
    for (const [k, v] of Object.entries(lexicon.kinship.terms || {})) {
      nouns.push({ form: v.praemali, gloss: k, formType: 'kinship', cls: 'sentient' })
    }
    const pronouns = Object.entries(lexicon.functionWords.pronouns || {}).map(([k, v]) => ({
      form: v.form,
      gloss: v.meaning,
      formType: 'pronoun',
      cls: k.includes('_ani') ? 'animal' : k.includes('_obj') ? 'object' : 'sentient',
    }))
    const temporal = Object.entries(lexicon.functionWords.temporal || {}).map(([k, v]) => ({ form: v, gloss: k }))
    const modals = Object.entries(lexicon.functionWords.modals || {}).map(([k, v]) => ({
      form: v.form,
      gloss: k,
      key: k,
      register: v.register,
      note: v.note,
    }))
    const preps = Object.entries(lexicon.functionWords.prepositions || {}).map(([k, v]) => ({
      form: v.form,
      gloss: k,
      case: v.case,
    }))
    nouns.sort((a, b) => a.gloss.localeCompare(b.gloss))
    verbs.sort((a, b) => a.gloss.localeCompare(b.gloss))
    adjectives.sort((a, b) => a.gloss.localeCompare(b.gloss))
    return { nouns, verbs, adjectives, pronouns, temporal, modals, preps }
  }, [lexicon])

  // Noun class for a picked noun: pronoun class > star exception / agent >
  // remembered user choice > unknown (ask once, stored as a custom entry).
  const classFor = (opt) =>
    opt.cls ||
    nounClassFor({
      rootKey: opt.rootKey,
      formType: opt.formType,
      form: opt.form,
      register,
      overrides: lexicon.nounClassOverrides,
    })

  const rememberClass = async (opt, cls, slotKey) => {
    set(slotKey, { ...slots[slotKey], cls })
    try {
      await createCustomLexicon({
        entry_type: 'override',
        payload: { kind: 'noun_class', form: opt.form, noun_class: cls },
        global: true,
      })
    } catch {
      /* surfaced via the global error banner; the choice still applies locally */
    }
  }

  // ---- assemble live ----
  const result = useMemo(() => {
    const verbRoot = slots.verb?.rootEntry || null
    const aspectForm = verbRoot ? verbRoot.forms?.[aspect] || verbRoot.forms?.imperfective || verbRoot.forms?.perfective : null
    return assembleSentence({
      register,
      mode,
      lexicon,
      slots: {
        temporal: slots.temporal || null,
        subject: slots.subject ? { ...slots.subject, cls: slots.subject.cls ?? classFor(slots.subject) } : null,
        modal: slots.modal || null,
        mood: slots.mood || null,
        negate: slots.negate || null,
        verb: verbRoot ? { aspectForm, aspect, gloss: slots.verb.gloss, root: verbRoot } : null,
        object: slots.object ? { ...slots.object, plural: !!slots.objectPlural, rootEntry: slots.object.rootEntry } : null,
        locative: slots.locPrep || slots.locNoun ? { prep: slots.locPrep || null, noun: slots.locNoun || null } : null,
        predicate: slots.predicate
          ? { form: slots.predicate.form, gloss: slots.predicate.gloss, isAdjective: slots.predicate.formType !== 'noun' }
          : null,
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, register, mode, aspect, lexicon])

  const glossLine = result.tokens.map((t) => `${t.pr}(${t.gloss})`).join(' + ')
  const translationDraft = [
    slots.temporal?.gloss,
    mode === 'copula' ? slots.subject?.gloss : null,
    mode === 'copula' ? `is ${slots.predicate?.gloss || ''}` : null,
    mode === 'action' ? slots.subject?.gloss : null,
    mode === 'action' ? slots.modal?.gloss : null,
    mode === 'action' ? (slots.mood === 'optative' ? 'may' : slots.mood === 'imperative' ? '(command)' : null) : null,
    mode === 'action' ? slots.verb?.gloss : null,
    mode === 'action' ? slots.object?.gloss : null,
  ].filter(Boolean).join(' ')

  const needsClass = (slotKey) => {
    const s = slots[slotKey]
    return s && !s.cls && classFor(s) == null
  }

  async function savePhrase() {
    if (!result.ok) return
    try {
      await createSavedPhrase({
        register,
        praemali: result.sentence,
        gloss: glossLine,
        translation: translationDraft,
      })
      setSaveMsg('Saved to phrase library.')
      setTimeout(() => setSaveMsg(null), 2000)
    } catch {
      setSaveMsg('Save failed — see the error banner.')
    }
  }

  const classAsk = (slotKey) =>
    needsClass(slotKey) && (
      <span className="pr-class-ask">
        class?
        {['sentient', 'animal', 'object'].map((c) => (
          <button key={c} type="button" onClick={() => rememberClass(slots[slotKey], c, slotKey)}>
            {c}
          </button>
        ))}
      </span>
    )

  return (
    <div className="pr-pane">
      <div className="pr-builder-bar">
        <div className="seg" role="group" aria-label="Register">
          {REGISTERS.map((r) => (
            <button key={r} className={`seg-btn ${register === r ? 'on' : ''}`} onClick={() => setRegister(r)}>
              {r}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Sentence type">
          <button className={`seg-btn ${mode === 'action' ? 'on' : ''}`} onClick={() => setMode('action')}>
            Action
          </button>
          <button className={`seg-btn ${mode === 'copula' ? 'on' : ''}`} onClick={() => setMode('copula')}>
            X is Y
          </button>
        </div>
        {DIVINE_REGISTERS.has(register) && (
          <span className="pr-vso-hint">VSO · zero-copula · no uncertainty words</span>
        )}
      </div>

      {mode === 'action' ? (
        <div className="pr-slots">
          <SlotPicker label="Temporal" optional value={slots.temporal} options={pools.temporal}
            onPick={(o) => set('temporal', o)} onClear={() => set('temporal', null)} />
          <div className="pr-slot-wrap">
            <SlotPicker label="Subject" value={slots.subject} options={[...pools.pronouns, ...pools.nouns]}
              onPick={(o) => set('subject', { ...o, cls: classFor(o) })} onClear={() => set('subject', null)} />
            {classAsk('subject')}
          </div>
          <SlotPicker label="Modal" optional value={slots.modal} options={pools.modals}
            onPick={(o) => set('modal', o)} onClear={() => set('modal', null)} />
          <SlotPicker label="Mood" optional value={slots.mood ? { form: slots.mood } : null}
            options={[{ form: 'imperative', gloss: 'ka- command' }, { form: 'optative', gloss: 'naa- may it be' }]}
            onPick={(o) => set('mood', o.form)} onClear={() => set('mood', null)} />
          <SlotPicker label="Neg" optional value={slots.negate ? { form: slots.negate } : null}
            options={[{ form: 'verb', gloss: 'negate the verb (fa+verb)' }, { form: 'modal', gloss: 'negate the modal (fa+modal)' }]}
            onPick={(o) => set('negate', o.form)} onClear={() => set('negate', null)} />
          <div className="pr-slot-wrap">
            <SlotPicker label="Verb" value={slots.verb} options={pools.verbs}
              onPick={(o) => set('verb', o)} onClear={() => set('verb', null)} />
            {slots.verb && (
              <span className="pr-aspect">
                {['imperfective', 'perfective'].map((a) => (
                  <button key={a} type="button" className={aspect === a ? 'on' : ''} onClick={() => setAspect(a)}>
                    {a === 'imperfective' ? 'IMPF' : 'PFV'}
                  </button>
                ))}
              </span>
            )}
          </div>
          <div className="pr-slot-wrap">
            <SlotPicker label="Object" optional value={slots.object} options={[...pools.pronouns, ...pools.nouns]}
              onPick={(o) => set('object', o)} onClear={() => { set('object', null); set('objectPlural', false) }} />
            {slots.object && (
              <label className="pr-plural">
                <input type="checkbox" checked={!!slots.objectPlural} onChange={(e) => set('objectPlural', e.target.checked)} />
                plural
              </label>
            )}
          </div>
          <div className="pr-slot-wrap">
            <SlotPicker label="Locative" optional value={slots.locPrep} options={pools.preps}
              onPick={(o) => set('locPrep', o)} onClear={() => { set('locPrep', null); set('locNoun', null) }}
              render={(v) => `${v.form} (${v.gloss})`} />
            {slots.locPrep && (
              <SlotPicker label="Place" value={slots.locNoun} options={pools.nouns}
                onPick={(o) => set('locNoun', o)} onClear={() => set('locNoun', null)} />
            )}
          </div>
        </div>
      ) : (
        <div className="pr-slots">
          <div className="pr-slot-wrap">
            <SlotPicker label="Subject" value={slots.subject} options={[...pools.pronouns, ...pools.nouns]}
              onPick={(o) => set('subject', { ...o, cls: classFor(o) })} onClear={() => set('subject', null)} />
            {classAsk('subject')}
          </div>
          <SlotPicker label="Neg" optional value={slots.negate ? { form: slots.negate } : null}
            options={[{ form: 'predicate', gloss: 'negate the predicate (fa+…)' }]}
            onPick={(o) => set('negate', o.form)} onClear={() => set('negate', null)} />
          <SlotPicker label="Predicate" value={slots.predicate} options={[...pools.adjectives, ...pools.nouns]}
            onPick={(o) => set('predicate', o)} onClear={() => set('predicate', null)} />
        </div>
      )}

      {result.errors.length > 0 && (
        <div className="pr-errors" role="alert">
          {result.errors.map((e, i) => (
            <div key={i} className="pr-error">
              <AlertTriangle size={14} /> {e.text}
              {e.suggestion && <div className="pr-suggestion">→ {e.suggestion}</div>}
            </div>
          ))}
        </div>
      )}
      {result.warnings.map((w, i) => (
        <div key={i} className="pr-warning">
          <Flame size={13} /> {w.text} <span className="pr-warn-tag">mortal speech</span>
        </div>
      ))}

      {result.ok && (
        <div className="pr-output">
          <div className="pr-sentence">
            <span>{result.sentence}</span>
            <CopyBtn text={result.sentence} />
          </div>
          <div className="pr-gloss">
            {result.tokens.map((t, i) => (
              <span key={i} className="pr-gloss-token">
                <b>{t.pr}</b>
                <em>{t.gloss}</em>
              </span>
            ))}
          </div>
          <div className="pr-output-actions">
            <button type="button" className="toggle" onClick={savePhrase}>
              <BookMarked size={14} /> Save phrase
            </button>
            {saveMsg && <span className="pr-savemsg">{saveMsg}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Phrases --------------------------------------------------------------------
function PhrasesView() {
  const { savedPhrases, deleteSavedPhrase } = useStore()
  const [q, setQ] = useState('')
  const canon = useMemo(() => canonicalPhrases(baseLexicon), [])
  const all = useMemo(() => {
    const mine = savedPhrases.map((p) => ({ ...p, canon: false, category: 'Saved' }))
    const list = [...canon, ...mine]
    const needle = q.toLowerCase().trim()
    return needle
      ? list.filter((p) => `${p.praemali} ${p.translation} ${p.category}`.toLowerCase().includes(needle))
      : list
  }, [savedPhrases, canon, q])

  return (
    <div className="pr-pane">
      <div className="search-box pr-search">
        <Search size={15} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search phrases …" />
      </div>
      <ul className="pr-phrases">
        {all.map((p) => (
          <li key={p.id} className="pr-phrase">
            <div className="pr-phrase-main">
              <span className="pr-form big">{p.praemali}</span>
              <CopyBtn text={p.praemali} small />
              <RegisterBadge register={p.register} />
              <span className="pr-kind">{p.category}{p.canon ? ' · canon' : ''}</span>
              {!p.canon && (
                <button type="button" className="icon-btn sm" title="Delete phrase" onClick={() => deleteSavedPhrase(p.id)}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            {p.translation && <div className="pr-phrase-tr">{p.translation}</div>}
            {p.gloss && <div className="pr-phrase-gloss">{p.gloss}</div>}
          </li>
        ))}
        {!all.length && <p className="hint">No phrases yet — build one and save it.</p>}
      </ul>
    </div>
  )
}

// ---- Add Word ---------------------------------------------------------------------
const DEFAULT_TEMPLATES = ['simple_noun', 'agent', 'adjective', 'perfective', 'imperfective', 'plural']

function AddWordView({ lexicon }) {
  const { createCustomLexicon, deleteCustomLexicon, customLexicon } = useStore()
  const [en, setEn] = useState('')
  const [de, setDe] = useState('')
  const [cons, setCons] = useState(['', '', ''])
  const [register, setRegister] = useState('all')
  const [selected, setSelected] = useState(DEFAULT_TEMPLATES)
  const [overrides, setOverrides] = useState({}) // formType → user-edited form
  const [global, setGlobal] = useState(true)
  const [msg, setMsg] = useState(null)
  const fileRef = useRef(null)

  const collision = useMemo(
    () => (cons.every((c) => c.trim()) ? findRootCollision(lexicon, cons) : null),
    [lexicon, cons],
  )
  const generated = useMemo(() => {
    if (!cons.every((c) => c.trim())) return {}
    const g = generateForms(cons.map((c) => c.toLowerCase().trim()), baseLexicon.templates, selected)
    return { ...g, ...overrides }
  }, [cons, selected, overrides])

  const primary = generated.simple_noun || Object.values(generated)[0] || ''
  const rootKey = cons.map((c) => c.toUpperCase().trim()).join('-')
  const canSave = en.trim() && de.trim() && cons.every((c) => c.trim()) && !collision && primary

  async function save() {
    const forms = {}
    for (const t of selected) if (generated[t]) forms[t === 'simple_noun' ? 'noun' : t] = generated[t]
    try {
      await createCustomLexicon({
        entry_type: 'root',
        global,
        payload: {
          root: rootKey,
          consonants: cons.map((c) => c.toLowerCase().trim()),
          meaning: en.trim(),
          register,
          forms,
          translations: { [en.trim().toLowerCase()]: forms.noun || primary },
          translations_de: { [de.trim()]: forms.noun || primary },
        },
      })
      setMsg(`Root ${rootKey} saved — it is live in Lookup and Builder now.`)
      setEn(''); setDe(''); setCons(['', '', '']); setOverrides({})
      setTimeout(() => setMsg(null), 3500)
    } catch {
      setMsg('Save failed — see the error banner.')
    }
  }

  function exportCustom() {
    const data = customLexicon.map((e) => ({ entry_type: e.entry_type, payload: e.payload }))
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'praemali_custom_entries.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function importCustom(file) {
    try {
      const rows = JSON.parse(await file.text())
      if (!Array.isArray(rows)) throw new Error('not an array')
      let n = 0
      for (const r of rows) {
        if (r?.entry_type && r?.payload) {
          await createCustomLexicon({ entry_type: r.entry_type, payload: r.payload, global: true })
          n++
        }
      }
      setMsg(`Imported ${n} entr${n === 1 ? 'y' : 'ies'}.`)
    } catch {
      setMsg('Import failed — expected a JSON array of { entry_type, payload }.')
    }
  }

  return (
    <div className="pr-pane pr-addword">
      <div className="pr-add-grid">
        <label className="field"><span>English meaning</span>
          <input value={en} onChange={(e) => setEn(e.target.value)} placeholder="e.g. bridge" /></label>
        <label className="field"><span>German meaning</span>
          <input value={de} onChange={(e) => setDe(e.target.value)} placeholder="z. B. Brücke" /></label>
        <div className="field"><span>Root (three consonants)</span>
          <div className="pr-cons">
            {[0, 1, 2].map((i) => (
              <input key={i} value={cons[i]} maxLength={2} placeholder={`C${i + 1}`}
                onChange={(e) => setCons((c) => c.map((v, j) => (j === i ? e.target.value.replace(/[^a-z]/gi, '') : v)))} />
            ))}
            <span className="pr-rootkey">{cons.every((c) => c.trim()) ? rootKey : ''}</span>
          </div>
        </div>
        <label className="field"><span>Register</span>
          <select value={register} onChange={(e) => setRegister(e.target.value)}>
            {['all', ...REGISTERS].map((r) => <option key={r} value={r}>{r}</option>)}
          </select></label>
      </div>

      {collision && (
        <div className="pr-errors" role="alert">
          <div className="pr-error">
            <AlertTriangle size={14} /> Root collision: <b>{collision.root}</b> already means “{collision.meaning}”.
            The language avoids double meanings — pick a different consonant triple (or edit the existing root below).
          </div>
        </div>
      )}

      <div className="pr-templates">
        <span className="pr-slot-label">Templates</span>
        {Object.entries(baseLexicon.templates).map(([key, t]) => (
          <label key={key} className={`pr-tpl ${selected.includes(key) ? 'on' : ''}`} title={t.function}>
            <input type="checkbox" checked={selected.includes(key)}
              onChange={(e) => setSelected((s) => (e.target.checked ? [...s, key] : s.filter((x) => x !== key)))} />
            {key.replace(/_/g, ' ')}
          </label>
        ))}
      </div>

      {cons.every((c) => c.trim()) && !collision && (
        <div className="pr-genforms">
          <span className="pr-slot-label">Generated forms — edit any (base-form diversification is expected)</span>
          <div className="pr-gen-grid">
            {selected.filter((t) => generated[t]).map((t) => (
              <label key={t} className="field pr-genfield">
                <span>{t.replace(/_/g, ' ')}</span>
                <input value={generated[t]} onChange={(e) => setOverrides((o) => ({ ...o, [t]: e.target.value }))} />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="pr-add-actions">
        <label className="checkbox">
          <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} />
          <span>Available in all projects</span>
        </label>
        <button type="button" className="toggle primary" disabled={!canSave} onClick={save}>
          <Plus size={14} /> Save word
        </button>
        <span className="map-toolbar-spacer" />
        <button type="button" className="toggle" onClick={exportCustom} title="Export custom entries as JSON">
          <Download size={14} /> Export
        </button>
        <button type="button" className="toggle" onClick={() => fileRef.current?.click()} title="Import custom entries from JSON">
          <Upload size={14} /> Import
        </button>
        <input ref={fileRef} type="file" accept="application/json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importCustom(f); e.target.value = '' }} />
      </div>
      {msg && <p className="pr-savemsg">{msg}</p>}

      {customLexicon.length > 0 && (
        <div className="pr-customlist">
          <span className="pr-slot-label">Your entries ({customLexicon.length})</span>
          <ul>
            {customLexicon.map((e) => (
              <li key={e.id}>
                <span className="pr-kind">{e.entry_type}</span>
                <b>{e.payload?.root || e.payload?.form || e.payload?.name}</b>
                <span className="pr-custom-meaning">{e.payload?.meaning || e.payload?.noun_class || ''}</span>
                {e.project_id == null && <span className="pr-kind">all projects</span>}
                <button type="button" className="icon-btn sm" title="Delete entry" onClick={() => deleteCustomLexicon(e.id)}>
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ---- shell ----------------------------------------------------------------------
export default function PraemaliView() {
  const lexicon = useLexicon()
  const [tab, setTab] = useState('lookup')
  const TABS = [
    ['lookup', 'Lookup', Search],
    ['builder', 'Builder', Hammer],
    ['phrases', 'Phrases', BookMarked],
    ['add', 'Add word', Plus],
  ]
  return (
    <div className="praemali-view">
      <div className="pr-head">
        <h2>Praemali</h2>
        <span className="pr-meta">
          {lexicon.roots.length} roots · lexicon v{lexicon.meta?.version}
          {lexicon.customCount > 0 && ` · ${lexicon.customCount} custom`}
        </span>
        <nav className="seg pr-tabs" aria-label="Praemali views">
          {TABS.map(([k, label, Icon]) => (
            <button key={k} className={`seg-btn ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </nav>
      </div>
      {tab === 'lookup' && <LookupView lexicon={lexicon} />}
      {tab === 'builder' && <BuilderView lexicon={lexicon} />}
      {tab === 'phrases' && <PhrasesView />}
      {tab === 'add' && <AddWordView lexicon={lexicon} />}
    </div>
  )
}
