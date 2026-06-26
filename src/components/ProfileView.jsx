import { useState } from 'react'
import { ArrowLeft, KeyRound, BookOpen, Check, AlertTriangle, List } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { useAuth } from '../auth/AuthProvider.jsx'

// Profile: change password (Supabase auth) + a "Controls & syntax" reference
// for how the editor works.
export default function ProfileView() {
  const { setView } = useStore()
  const { user, isSupabaseConfigured } = useAuth()

  return (
    <div className="profile-view">
      <div className="profile-inner">
        <div className="profile-head">
          <button className="icon-btn with-label" onClick={() => setView('write')}>
            <ArrowLeft size={16} /> Zurück
          </button>
          <h2>Profil</h2>
          {user?.email && <span className="profile-email">{user.email}</span>}
        </div>

        <PasswordSection enabled={isSupabaseConfigured} />
        <SyntaxGuide />
      </div>
    </div>
  )
}

function PasswordSection({ enabled }) {
  const { changePassword } = useAuth()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { type: 'ok' | 'err', text }

  async function onSubmit(e) {
    e.preventDefault()
    setMsg(null)
    if (pw.length < 6) return setMsg({ type: 'err', text: 'Passwort muss mindestens 6 Zeichen haben.' })
    if (pw !== pw2) return setMsg({ type: 'err', text: 'Passwörter stimmen nicht überein.' })
    setBusy(true)
    const res = await changePassword(pw)
    setBusy(false)
    if (res.ok) {
      setMsg({ type: 'ok', text: 'Passwort aktualisiert.' })
      setPw('')
      setPw2('')
    } else {
      setMsg({ type: 'err', text: res.error || 'Aktualisierung fehlgeschlagen.' })
    }
  }

  return (
    <section className="profile-section">
      <h3>
        <KeyRound size={17} /> Passwort ändern
      </h3>
      {!enabled && (
        <p className="hint">Im lokalen Modus nicht verfügbar (kein Supabase-Backend).</p>
      )}
      <form className="profile-form" onSubmit={onSubmit}>
        <label className="field">
          <span>Neues Passwort</span>
          <input
            type="password"
            autoComplete="new-password"
            value={pw}
            disabled={!enabled || busy}
            onChange={(e) => setPw(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Neues Passwort bestätigen</span>
          <input
            type="password"
            autoComplete="new-password"
            value={pw2}
            disabled={!enabled || busy}
            onChange={(e) => setPw2(e.target.value)}
          />
        </label>
        {msg && (
          <div className={`profile-msg ${msg.type}`}>
            {msg.type === 'ok' ? <Check size={15} /> : <AlertTriangle size={15} />} {msg.text}
          </div>
        )}
        <button type="submit" className="toggle primary" disabled={!enabled || busy}>
          {busy ? 'Speichert …' : 'Passwort aktualisieren'}
        </button>
      </form>
    </section>
  )
}

// Sample uses the same .hashlink classes as the editor preview.
const SYNTAX = [
  {
    code: '# Überschrift',
    title: 'Überschrift',
    desc: 'Raute + Leerzeichen am Zeilenanfang. „## “ und „### “ für kleinere Ebenen.',
    sample: <span className="syntax-h">Überschrift</span>,
  },
  {
    code: '**fett**',
    title: 'Fett',
    desc: 'Auch mit Strg/Cmd+B auf die Auswahl.',
    sample: <strong>fett</strong>,
  },
  {
    code: '*kursiv*  ·  _kursiv_',
    title: 'Kursiv',
    desc: 'Auch mit Strg/Cmd+I auf die Auswahl.',
    sample: <em>kursiv</em>,
  },
  {
    code: '> Zitat',
    title: 'Blockzitat',
    desc: '„> “ am Zeilenanfang.',
    sample: <span className="syntax-quote">Zitat</span>,
  },
  {
    code: '- Punkt',
    title: 'Liste',
    desc: '„- “ (oder „1. “ für nummeriert) am Zeilenanfang.',
    sample: (
      <span className="chip-label">
        <List size={14} /> Punkt
      </span>
    ),
  },
  {
    code: '[Text](https://…)',
    title: 'Link',
    desc: 'Markdown-Link.',
    sample: <span className="syntax-link">Text</span>,
  },
  {
    code: '`Code`',
    title: 'Code',
    desc: 'Inline-Code in Backticks.',
    sample: <code>Code</code>,
  },
]

function SyntaxGuide() {
  return (
    <section className="profile-section">
      <h3>
        <BookOpen size={17} /> Steuerung &amp; Syntax
      </h3>
      <p className="hint">So funktioniert der Editor. Die Vorschau zeigt das Ergebnis.</p>

      <div className="syntax-table">
        {SYNTAX.map((s) => (
          <div className="syntax-row" key={s.title}>
            <code className="syntax-code">{s.code}</code>
            <div className="syntax-meaning">
              <span className="syntax-title">{s.title}</span>
              <span className="syntax-desc">{s.desc}</span>
            </div>
            <div className="syntax-sample">{s.sample}</div>
          </div>
        ))}
      </div>

      <h4 className="syntax-subhead">Karten-Verlinkung</h4>
      <div className="syntax-table">
        <div className="syntax-row">
          <code className="syntax-code">#Name</code>
          <div className="syntax-meaning">
            <span className="syntax-title">Karten-Link</span>
            <span className="syntax-desc">
              Verlinkt eine Figur oder einen Ort. Tippe „#“, um Karten vorzuschlagen. In der Vorschau
              zeigt ein Klick/Hover eine Vorschau der Karte.
            </span>
          </div>
          <div className="syntax-sample">
            <span className="hashlink resolved static">#Amrex</span>
          </div>
        </div>
        <div className="syntax-row">
          <code className="syntax-code">#Name</code>
          <div className="syntax-meaning">
            <span className="syntax-title">Provisorisch</span>
            <span className="syntax-desc">Der Name der verlinkten Karte ist noch nicht final.</span>
          </div>
          <div className="syntax-sample">
            <span className="hashlink resolved provisional static">#Amrex</span>
          </div>
        </div>
        <div className="syntax-row">
          <code className="syntax-code">#Name</code>
          <div className="syntax-meaning">
            <span className="syntax-title">Unaufgelöst</span>
            <span className="syntax-desc">
              Keine passende Karte (Tippfehler oder noch nicht angelegt).
            </span>
          </div>
          <div className="syntax-sample">
            <span className="hashlink unresolved static">#Bambam</span>
          </div>
        </div>
      </div>
    </section>
  )
}
