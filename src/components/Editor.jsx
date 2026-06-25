import { useMemo } from 'react'
import { marked } from 'marked'

// Distraction-light Markdown editor. Plain fast textarea; preview is optional
// and toggled by the parent. No toolbars, no friction.
export default function Editor({ value, onChange, preview }) {
  const html = useMemo(
    () => (preview ? marked.parse(value || '', { breaks: true }) : ''),
    [value, preview],
  )

  return (
    <div className={`editor ${preview ? 'split' : ''}`}>
      <textarea
        className="editor-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Schreib los …"
        spellCheck
        autoCapitalize="sentences"
      />
      {preview && (
        <div className="editor-preview markdown" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  )
}
