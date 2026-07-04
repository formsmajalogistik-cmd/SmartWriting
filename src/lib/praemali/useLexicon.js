// The merged Praemali lexicon as a React hook: bundled base JSON (single
// source of truth, ships with the app) + the user's custom_lexicon_entries
// from the store (offline-mirrored, synced). Memoized — rebuilt only when the
// custom entries change; the base never changes within a session.
import { useMemo } from 'react'
import baseLexicon from '../../data/praemali_lexicon_v2.json'
import { useStore } from '../../state/store.jsx'
import { mergeLexicon } from './lexicon.js'

export { baseLexicon }

export function useLexicon() {
  const { customLexicon } = useStore()
  return useMemo(() => mergeLexicon(baseLexicon, customLexicon), [customLexicon])
}
