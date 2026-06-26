// Compute the pixel coordinates of the caret inside a <textarea>, relative to
// the textarea's padding box. Mirror-div technique (trimmed from the
// well-known textarea-caret-position approach). Used to anchor the #-autocomplete.
const MIRROR_PROPS = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'whiteSpace',
  'wordWrap',
  'wordBreak',
]

export function getCaretCoordinates(textarea, position) {
  const div = document.createElement('div')
  const style = div.style
  const computed = window.getComputedStyle(textarea)

  style.position = 'absolute'
  style.visibility = 'hidden'
  style.whiteSpace = 'pre-wrap'
  style.wordWrap = 'break-word'
  style.overflow = 'hidden'

  for (const prop of MIRROR_PROPS) style[prop] = computed[prop]
  // Honor the textarea's own width including any scrollbar.
  style.width = textarea.clientWidth + 'px'

  div.textContent = textarea.value.substring(0, position)
  const span = document.createElement('span')
  // Non-empty so it has layout; the remaining text keeps wrapping correct.
  span.textContent = textarea.value.substring(position) || '.'
  div.appendChild(span)

  document.body.appendChild(div)
  const top = span.offsetTop + parseInt(computed.borderTopWidth, 10)
  const left = span.offsetLeft + parseInt(computed.borderLeftWidth, 10)
  const height = parseInt(computed.lineHeight, 10) || span.offsetHeight
  document.body.removeChild(div)

  return { top, left, height }
}
