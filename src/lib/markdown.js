// Shared Marked configuration bits.
//
// German novels quote dialogue with guillemets »…« — the editor substitutes
// them for typed "<"/">" — so Markdown BLOCKQUOTES are deliberately disabled
// everywhere manuscript/idea Markdown is rendered: a line starting with "> "
// stays a literal paragraph instead of becoming a quote block.
//
// Returning `undefined` (NOT false — false would fall back to the built-in
// tokenizer) makes the lexer skip the blockquote rule entirely; the line is
// then consumed by the paragraph/text rules and rendered literally.
export const noBlockquote = {
  tokenizer: {
    blockquote() {
      return undefined
    },
  },
}

// The German quote substitution applied while typing in the editor:
// ">" → » (opening) and "<" → « (closing) — the INWARD-pointing German form.
export const GUILLEMET_MAP = { '>': '»', '<': '«' }
