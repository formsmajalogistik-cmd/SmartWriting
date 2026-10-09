// Layout rule for the chapter's side panels (Metadaten + Figuren im Kapitel).
// The writing column has a FIXED measure (--editor-page-w) and a side panel
// must never shrink it, so the layout follows the space actually available
// next to the editor:
//   • split  — room for the column AND both panels: they sit side by side;
//   • tabs   — room for the column and ONE panel: they share a tabbed sidebar;
//   • drawer — not even that (phones, narrow windows): both live in a bottom
//              sheet opened from the chapter toolbar, closed by default.
// Pure (no DOM) so it is unit-tested alongside the presence logic.
export const META_W = 320
export const CAST_W = 300
export const GUTTER = 32 // breathing room around the page column

export function panelMode(available, column = 672) {
  if (available >= column + GUTTER + META_W + CAST_W) return 'split'
  if (available >= column + GUTTER + META_W) return 'tabs'
  return 'drawer'
}
