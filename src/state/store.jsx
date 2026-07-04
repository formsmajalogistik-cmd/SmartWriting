// Central app store: wraps the repository, holds loaded data for the active
// project, and exposes actions. Components never touch the repository directly;
// they call these actions, which mutate via the repo and refresh local state.
import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react'
import { getRepository } from '../data/repository.js'
import {
  hydrateProject,
  bootstrapProjects,
  setSyncProject,
  onPullApplied,
} from '../data/syncEngine.js'
import { findNameOccurrences, replaceNameReferences } from '../lib/hashlinks.js'

const ACTIVE_PROJECT_KEY = 'smartwriting.activeProjectId'
const ACTIVE_CHAPTER_KEY = 'smartwriting.activeChapterId'

const StoreContext = createContext(null)

export function StoreProvider({ children }) {
  const [ready, setReady] = useState(false)
  const [projects, setProjects] = useState([])
  // Surfaced network state: never fail silently.
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(0)
  const clearError = useCallback(() => setError(null), [])

  // Wrap the repository so every call tracks in-flight writes (`saving`) and
  // routes failures to a visible error. Stable identity (created once).
  const repo = useMemo(() => {
    const base = getRepository()
    const wrapped = {}
    for (const key of Object.keys(base)) {
      // `list*` and `get*` are reads — they don't flip the "saving" indicator.
      const isWrite = !key.startsWith('list') && !key.startsWith('get')
      wrapped[key] = async (...args) => {
        if (isWrite) setBusy((b) => b + 1)
        try {
          const result = await base[key](...args)
          if (isWrite) setError(null)
          return result
        } catch (e) {
          setError(e?.message || String(e))
          throw e
        } finally {
          if (isWrite) setBusy((b) => b - 1)
        }
      }
    }
    return wrapped
  }, [])
  const [activeProjectId, setActiveProjectId] = useState(
    () => localStorage.getItem(ACTIVE_PROJECT_KEY) || null,
  )

  // Active-project scoped collections.
  const [chapters, setChapters] = useState([])
  const [characters, setCharacters] = useState([])
  const [places, setPlaces] = useState([])
  const [locations, setLocations] = useState([])
  const [events, setEvents] = useState([])
  const [regions, setRegions] = useState([])
  const [routes, setRoutes] = useState([])
  const [customLexicon, setCustomLexicon] = useState([])
  const [savedPhrases, setSavedPhrases] = useState([])
  // Versions of the currently open chapter (PROSE only; metadata stays on the chapter).
  const [chapterVersions, setChapterVersions] = useState([])
  const [activeChapterId, setActiveChapterId] = useState(
    () => localStorage.getItem(ACTIVE_CHAPTER_KEY) || null,
  )

  // Top-level navigation (which view is showing) + a card to focus when its
  // view opens (e.g. clicking a #link in the editor jumps to that card).
  const [view, setView] = useState('write')
  const [focusCard, setFocusCard] = useState(null) // { kind, id } | null
  // A manuscript-search hit to jump to: opens the chapter and selects the match
  // range in the editor. { chapterId, start, end } | null.
  const [focusMatch, setFocusMatch] = useState(null)

  // --- loaders ---------------------------------------------------------
  const refreshProjects = useCallback(async () => {
    const list = await repo.listProjects()
    setProjects(list)
    return list
  }, [])

  const refreshChapters = useCallback(async (pid) => {
    const list = pid ? await repo.listChapters(pid) : []
    setChapters(list)
    return list
  }, [])
  const refreshCharacters = useCallback(async (pid) => {
    setCharacters(pid ? await repo.listCharacters(pid) : [])
  }, [])
  const refreshPlaces = useCallback(async (pid) => {
    setPlaces(pid ? await repo.listPlaces(pid) : [])
  }, [])
  const refreshLocations = useCallback(async (pid) => {
    setLocations(pid ? await repo.listCharacterLocations(pid) : [])
  }, [])
  const refreshEvents = useCallback(async (pid) => {
    setEvents(pid ? await repo.listEvents(pid) : [])
  }, [])
  const refreshRegions = useCallback(async (pid) => {
    setRegions(pid ? await repo.listRegions(pid) : [])
  }, [])
  const refreshRoutes = useCallback(async (pid) => {
    setRoutes(pid ? await repo.listRoutes(pid) : [])
  }, [])
  const refreshCustomLexicon = useCallback(async (pid) => {
    setCustomLexicon(pid ? await repo.listCustomLexicon(pid) : [])
  }, [])
  const refreshSavedPhrases = useCallback(async (pid) => {
    setSavedPhrases(pid ? await repo.listSavedPhrases(pid) : [])
  }, [])
  const refreshChapterVersions = useCallback(async (pid, chapterId) => {
    setChapterVersions(pid && chapterId ? await repo.listChapterVersions(pid, { chapterId }) : [])
  }, [])

  // Initial load. Always reach `ready` so a load error shows the app shell
  // (with the error banner) rather than a stuck spinner.
  useEffect(() => {
    ;(async () => {
      try {
        // Local-first: a fresh device knows no projects until the list is
        // pulled from the remote (best-effort; no-op offline / non-sync modes).
        await bootstrapProjects().catch(() => {})
        const list = await refreshProjects()
        setActiveProjectId((cur) => (list.some((p) => p.id === cur) ? cur : list[0]?.id || null))
      } catch {
        /* error already surfaced via the guarded repo */
      } finally {
        setReady(true)
      }
    })()
  }, [refreshProjects])

  // When the active project changes, (re)load its collections and restore the
  // last-open chapter if it belongs to this project (survives reloads).
  useEffect(() => {
    if (activeProjectId) localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId)
    else localStorage.removeItem(ACTIVE_PROJECT_KEY)
    ;(async () => {
      try {
        // Local-first: seed the local cache from the remote on open (best-effort;
        // no-op offline or when local changes are still queued). Reads below then
        // come from the local store, so the app works with or without a network.
        // Registering the project also starts the periodic incoming pull.
        setSyncProject(activeProjectId)
        if (activeProjectId) await hydrateProject(activeProjectId).catch(() => {})
        const [chs] = await Promise.all([
          refreshChapters(activeProjectId),
          refreshCharacters(activeProjectId),
          refreshPlaces(activeProjectId),
          refreshLocations(activeProjectId),
          refreshEvents(activeProjectId),
          refreshRegions(activeProjectId),
          refreshRoutes(activeProjectId),
          refreshCustomLexicon(activeProjectId),
          refreshSavedPhrases(activeProjectId),
        ])
        setActiveChapterId((cur) => (chs.some((c) => c.id === cur) ? cur : null))
      } catch {
        /* error already surfaced via the guarded repo */
      }
    })()
  }, [activeProjectId, refreshChapters, refreshCharacters, refreshPlaces, refreshLocations, refreshEvents, refreshRegions, refreshRoutes, refreshCustomLexicon, refreshSavedPhrases])

  // Persist the active chapter so a reload reopens it.
  useEffect(() => {
    if (activeChapterId) localStorage.setItem(ACTIVE_CHAPTER_KEY, activeChapterId)
    else localStorage.removeItem(ACTIVE_CHAPTER_KEY)
  }, [activeChapterId])

  // Incoming sync: when a pull merged remote changes into the local store,
  // re-read the affected collections so the UI reflects them live.
  useEffect(() => {
    return onPullApplied(async (tables) => {
      const t = new Set(tables)
      try {
        if (t.has('projects')) await refreshProjects()
        if (t.has('chapters')) await refreshChapters(activeProjectId)
        if (t.has('characters')) await refreshCharacters(activeProjectId)
        if (t.has('places')) await refreshPlaces(activeProjectId)
        if (t.has('character_locations')) await refreshLocations(activeProjectId)
        if (t.has('events')) await refreshEvents(activeProjectId)
        if (t.has('regions')) await refreshRegions(activeProjectId)
        if (t.has('routes')) await refreshRoutes(activeProjectId)
        if (t.has('custom_lexicon_entries')) await refreshCustomLexicon(activeProjectId)
        if (t.has('saved_phrases')) await refreshSavedPhrases(activeProjectId)
        if (t.has('chapter_versions') && activeChapterId) {
          await refreshChapterVersions(activeProjectId, activeChapterId)
        }
      } catch {
        /* surfaced via the guarded repo / sync status */
      }
    })
  }, [
    activeProjectId,
    activeChapterId,
    refreshProjects,
    refreshChapters,
    refreshCharacters,
    refreshPlaces,
    refreshLocations,
    refreshEvents,
    refreshRegions,
    refreshRoutes,
    refreshCustomLexicon,
    refreshSavedPhrases,
    refreshChapterVersions,
  ])

  // Load the open chapter's versions (for the version selector / compare).
  useEffect(() => {
    refreshChapterVersions(activeProjectId, activeChapterId).catch(() => {})
  }, [activeProjectId, activeChapterId, refreshChapterVersions])

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId],
  )
  const activeChapter = useMemo(
    () => chapters.find((c) => c.id === activeChapterId) || null,
    [chapters, activeChapterId],
  )

  // --- project actions -------------------------------------------------
  const createProject = useCallback(
    async (name) => {
      const p = await repo.createProject({ name })
      await refreshProjects()
      setActiveProjectId(p.id)
      return p
    },
    [refreshProjects],
  )
  const renameProject = useCallback(
    async (id, name) => {
      await repo.updateProject(id, { name })
      await refreshProjects()
    },
    [refreshProjects],
  )
  const deleteProject = useCallback(
    async (id) => {
      await repo.deleteProject(id)
      const list = await refreshProjects()
      setActiveProjectId((cur) => (cur === id ? list[0]?.id || null : cur))
    },
    [refreshProjects],
  )

  // --- book actions ----------------------------------------------------
  const createBook = useCallback(
    async (title) => {
      await repo.createBook(activeProjectId, { title })
      await refreshProjects()
    },
    [activeProjectId, refreshProjects],
  )
  const renameBook = useCallback(
    async (bookId, title) => {
      await repo.renameBook(activeProjectId, bookId, title)
      await refreshProjects()
    },
    [activeProjectId, refreshProjects],
  )
  const deleteBook = useCallback(
    async (bookId) => {
      await repo.deleteBook(activeProjectId, bookId)
      await refreshProjects()
      await refreshChapters(activeProjectId)
      await refreshLocations(activeProjectId)
    },
    [activeProjectId, refreshProjects, refreshChapters, refreshLocations],
  )

  // --- chapter actions -------------------------------------------------
  const createChapter = useCallback(
    async ({ book = null, title } = {}) => {
      const c = await repo.createChapter(activeProjectId, { book, title })
      await refreshChapters(activeProjectId)
      setActiveChapterId(c.id)
      return c
    },
    [activeProjectId, refreshChapters],
  )
  const updateChapter = useCallback(
    async (id, patch) => {
      const updated = await repo.updateChapter(id, patch)
      // Patch in place to avoid clobbering editor focus on every keystroke.
      setChapters((prev) => prev.map((c) => (c.id === id ? updated : c)))
      return updated
    },
    [],
  )
  const renameChapter = useCallback(
    async (id, title) => updateChapter(id, { title }),
    [updateChapter],
  )
  const deleteChapter = useCallback(
    async (id) => {
      await repo.deleteChapter(id)
      await refreshChapters(activeProjectId)
      await refreshLocations(activeProjectId)
      setActiveChapterId((cur) => (cur === id ? null : cur))
    },
    [activeProjectId, refreshChapters, refreshLocations],
  )

  // --- chapter version actions ----------------------------------------
  // Editor body writes go through the ACTIVE version (and mirror chapters.body).
  const saveChapterBody = useCallback(async (chapterId, body) => {
    const updated = await repo.saveActiveVersionBody(chapterId, body)
    setChapters((prev) => prev.map((c) => (c.id === chapterId ? updated : c)))
    // Keep the open chapter's version bodies fresh in memory so Compare and the
    // version selector reflect what was just typed (without a re-list per save).
    setChapterVersions((prev) =>
      prev.map((v) =>
        v.id === updated.active_version_id ? { ...v, body, updated_at: updated.updated_at } : v,
      ),
    )
    return updated
  }, [])
  const createVersion = useCallback(
    async (chapterId, { label, body } = {}) => {
      const v = await repo.createChapterVersion(activeProjectId, { chapterId, label, body })
      await refreshChapterVersions(activeProjectId, chapterId)
      return v
    },
    [activeProjectId, refreshChapterVersions],
  )
  const renameVersion = useCallback(
    async (versionId, label, chapterId) => {
      await repo.updateChapterVersion(versionId, { label })
      await refreshChapterVersions(activeProjectId, chapterId)
    },
    [activeProjectId, refreshChapterVersions],
  )
  const deleteVersion = useCallback(
    async (versionId, chapterId) => {
      await repo.deleteChapterVersion(versionId)
      await refreshChapterVersions(activeProjectId, chapterId)
    },
    [activeProjectId, refreshChapterVersions],
  )
  const setActiveVersion = useCallback(async (chapterId, versionId) => {
    const updated = await repo.setActiveVersion(chapterId, versionId)
    setChapters((prev) => prev.map((c) => (c.id === chapterId ? updated : c)))
    return updated
  }, [])

  // --- terrain actions (Phase 3, Stage A) -----------------------------
  // Loaded on demand (only when the map view opens) — the heights blob can be
  // tens of KB, so it is NOT pulled on every project switch. Reads/writes go
  // through the guarded repo, so errors surface in the banner and saves flip
  // the "speichert …" indicator.
  const loadTerrain = useCallback((pid) => repo.getTerrain(pid ?? activeProjectId), [activeProjectId])
  const createTerrain = useCallback(
    (opts) => repo.createTerrain(activeProjectId, opts),
    [activeProjectId],
  )
  const saveTerrain = useCallback(
    (patch) => repo.saveTerrain(activeProjectId, patch),
    [activeProjectId],
  )

  // --- region actions (map areas) -------------------------------------
  const createRegion = useCallback(
    async (opts) => {
      const r = await repo.createRegion(activeProjectId, opts || {})
      await refreshRegions(activeProjectId)
      return r
    },
    [activeProjectId, refreshRegions],
  )
  const updateRegion = useCallback(async (id, patch) => {
    const updated = await repo.updateRegion(id, patch)
    setRegions((prev) => prev.map((r) => (r.id === id ? updated : r)))
    return updated
  }, [])
  const deleteRegion = useCallback(
    async (id) => {
      await repo.deleteRegion(id)
      await refreshRegions(activeProjectId)
    },
    [activeProjectId, refreshRegions],
  )

  // --- route actions (authored journey lines) -------------------------
  const createRoute = useCallback(
    async (opts) => {
      const r = await repo.createRoute(activeProjectId, opts || {})
      await refreshRoutes(activeProjectId)
      return r
    },
    [activeProjectId, refreshRoutes],
  )
  const updateRoute = useCallback(async (id, patch) => {
    const updated = await repo.updateRoute(id, patch)
    setRoutes((prev) => prev.map((r) => (r.id === id ? updated : r)))
    return updated
  }, [])
  const deleteRoute = useCallback(
    async (id) => {
      await repo.deleteRoute(id)
      await refreshRoutes(activeProjectId)
    },
    [activeProjectId, refreshRoutes],
  )

  // --- Praemali actions (custom lexicon + saved phrases) ----------------
  const createCustomLexicon = useCallback(
    async (opts) => {
      const e = await repo.createCustomLexicon(activeProjectId, opts || {})
      await refreshCustomLexicon(activeProjectId)
      return e
    },
    [activeProjectId, refreshCustomLexicon],
  )
  const updateCustomLexicon = useCallback(
    async (id, patch) => {
      const updated = await repo.updateCustomLexicon(id, patch)
      await refreshCustomLexicon(activeProjectId)
      return updated
    },
    [activeProjectId, refreshCustomLexicon],
  )
  const deleteCustomLexicon = useCallback(
    async (id) => {
      await repo.deleteCustomLexicon(id)
      await refreshCustomLexicon(activeProjectId)
    },
    [activeProjectId, refreshCustomLexicon],
  )
  const createSavedPhrase = useCallback(
    async (opts) => {
      const p = await repo.createSavedPhrase(activeProjectId, opts || {})
      await refreshSavedPhrases(activeProjectId)
      return p
    },
    [activeProjectId, refreshSavedPhrases],
  )
  const deleteSavedPhrase = useCallback(
    async (id) => {
      await repo.deleteSavedPhrase(id)
      await refreshSavedPhrases(activeProjectId)
    },
    [activeProjectId, refreshSavedPhrases],
  )

  // --- character / place actions --------------------------------------
  const createCharacter = useCallback(
    async (name) => {
      const c = await repo.createCharacter(activeProjectId, { name })
      await refreshCharacters(activeProjectId)
      return c
    },
    [activeProjectId, refreshCharacters],
  )
  const updateCharacter = useCallback(
    async (id, patch) => {
      const updated = await repo.updateCharacter(id, patch)
      setCharacters((prev) => prev.map((c) => (c.id === id ? updated : c)))
      return updated
    },
    [],
  )
  const deleteCharacter = useCallback(
    async (id) => {
      await repo.deleteCharacter(id)
      await refreshCharacters(activeProjectId)
      await refreshLocations(activeProjectId)
    },
    [activeProjectId, refreshCharacters, refreshLocations],
  )

  // --- portrait image (Supabase Storage / local blob store) -----------
  // Storage-only: the resulting path is persisted onto the character card by
  // the editor's normal update flow, keeping a single writer of the record.
  const uploadPortrait = useCallback((characterId, blob, opts) =>
    repo.uploadPortrait(characterId, blob, opts), [])
  const getPortraitUrl = useCallback((path) => repo.getPortraitUrl(path), [])
  const deletePortrait = useCallback((path) => repo.deletePortrait(path), [])
  const createPlace = useCallback(
    async (name) => {
      const p = await repo.createPlace(activeProjectId, { name })
      await refreshPlaces(activeProjectId)
      return p
    },
    [activeProjectId, refreshPlaces],
  )
  const updatePlace = useCallback(
    async (id, patch) => {
      const updated = await repo.updatePlace(id, patch)
      setPlaces((prev) => prev.map((p) => (p.id === id ? updated : p)))
      return updated
    },
    [],
  )
  const deletePlace = useCallback(
    async (id) => {
      await repo.deletePlace(id)
      await refreshPlaces(activeProjectId)
      await refreshLocations(activeProjectId)
    },
    [activeProjectId, refreshPlaces, refreshLocations],
  )

  // --- event actions ---------------------------------------------------
  const createEvent = useCallback(
    async (title) => {
      const e = await repo.createEvent(activeProjectId, { title })
      await refreshEvents(activeProjectId)
      return e
    },
    [activeProjectId, refreshEvents],
  )
  const updateEvent = useCallback(
    async (id, patch) => {
      const updated = await repo.updateEvent(id, patch)
      setEvents((prev) => prev.map((e) => (e.id === id ? updated : e)))
      return updated
    },
    [],
  )
  const deleteEvent = useCallback(
    async (id) => {
      await repo.deleteEvent(id)
      await refreshEvents(activeProjectId)
    },
    [activeProjectId, refreshEvents],
  )
  // Two-way chapter<->event link lives in the event's card.chapter_ids list.
  const setEventInChapter = useCallback(
    async (eventId, chapterId, present) => {
      const ev = events.find((e) => e.id === eventId)
      if (!ev) return
      const cur = Array.isArray(ev.card?.chapter_ids) ? ev.card.chapter_ids : []
      const next = present ? [...new Set([...cur, chapterId])] : cur.filter((c) => c !== chapterId)
      await updateEvent(eventId, { card: { ...ev.card, chapter_ids: next } })
    },
    [events, updateEvent],
  )

  // --- export ----------------------------------------------------------
  // Gather a complete, current snapshot of the active project for export
  // (lexicon is fetched fresh since it has no live UI state).
  const exportSnapshot = useCallback(async () => {
    const lexicon = await repo.listLexicon(activeProjectId).catch(() => [])
    return {
      project: activeProject,
      chapters,
      characters,
      places,
      events,
      locations,
      regions,
      routes,
      lexicon,
    }
  }, [activeProjectId, activeProject, chapters, characters, places, events, locations, regions, routes])

  // --- Drive backup linkage (read/write; Drive logic lives in DriveProvider) -
  const getDriveLink = useCallback(() => repo.getDriveLink(), [])
  const saveDriveLink = useCallback((patch) => repo.saveDriveLink(patch), [])

  // --- navigation ------------------------------------------------------
  const openCard = useCallback((kind, id) => {
    setView(kind === 'place' ? 'places' : kind === 'event' ? 'events' : 'characters')
    setFocusCard({ kind, id })
  }, [])
  const consumeFocusCard = useCallback(() => setFocusCard(null), [])

  // Open a chapter in the writing view and (optionally) jump the editor to a
  // character range — used by manuscript search to land on the match.
  const openChapterAt = useCallback((chapterId, start = null, end = null) => {
    setActiveChapterId(chapterId)
    setView('write')
    setFocusMatch(start != null ? { chapterId, start, end } : null)
  }, [])
  const consumeFocusMatch = useCallback(() => setFocusMatch(null), [])

  // --- #reference rename helpers --------------------------------------
  // Find chapters whose body contains "#oldName" references.
  const findReferences = useCallback(
    (name) =>
      chapters
        .map((ch) => ({ chapter: ch, count: findNameOccurrences(ch.body || '', name).length }))
        .filter((r) => r.count > 0),
    [chapters],
  )
  // Rewrite "#oldName" -> "#newName" across all chapters. Returns totals.
  const renameReferences = useCallback(
    async (oldName, newName) => {
      let chaptersChanged = 0
      let refsChanged = 0
      for (const ch of chapters) {
        const { text, count } = replaceNameReferences(ch.body || '', oldName, newName)
        if (count > 0) {
          // Write through the active version so the mirror stays consistent.
          const updated = await repo.saveActiveVersionBody(ch.id, text)
          setChapters((prev) => prev.map((c) => (c.id === ch.id ? updated : c)))
          chaptersChanged += 1
          refsChanged += count
        }
      }
      return { chaptersChanged, refsChanged }
    },
    [chapters],
  )

  // --- character_locations actions ------------------------------------
  const setCharacterPresent = useCallback(
    async (chapterId, characterId, present) => {
      if (present) {
        await repo.setCharacterLocation(activeProjectId, { chapterId, characterId, placeId: null })
      } else {
        await repo.removeCharacterLocation(activeProjectId, { chapterId, characterId })
      }
      await refreshLocations(activeProjectId)
    },
    [activeProjectId, refreshLocations],
  )
  const setCharacterPlace = useCallback(
    async (chapterId, characterId, placeId) => {
      await repo.setCharacterLocation(activeProjectId, { chapterId, characterId, placeId })
      await refreshLocations(activeProjectId)
    },
    [activeProjectId, refreshLocations],
  )
  const setPlacePresent = useCallback(
    async (chapterId, placeId, present) => {
      if (present) {
        await repo.setPlacePresent(activeProjectId, { chapterId, placeId })
      } else {
        await repo.removePlacePresent(activeProjectId, { chapterId, placeId })
      }
      await refreshLocations(activeProjectId)
    },
    [activeProjectId, refreshLocations],
  )

  const value = {
    ready,
    saving: busy > 0,
    error,
    clearError,
    projects,
    activeProject,
    activeProjectId,
    setActiveProjectId,
    chapters,
    characters,
    places,
    locations,
    events,
    regions,
    routes,
    customLexicon,
    savedPhrases,
    chapterVersions,
    activeChapter,
    activeChapterId,
    setActiveChapterId,
    // navigation
    view,
    setView,
    focusCard,
    openCard,
    consumeFocusCard,
    focusMatch,
    openChapterAt,
    consumeFocusMatch,
    // actions
    createProject,
    renameProject,
    deleteProject,
    createBook,
    renameBook,
    deleteBook,
    createChapter,
    updateChapter,
    renameChapter,
    deleteChapter,
    saveChapterBody,
    createVersion,
    renameVersion,
    deleteVersion,
    setActiveVersion,
    loadTerrain,
    createTerrain,
    saveTerrain,
    createRegion,
    updateRegion,
    deleteRegion,
    createRoute,
    updateRoute,
    deleteRoute,
    createCustomLexicon,
    updateCustomLexicon,
    deleteCustomLexicon,
    createSavedPhrase,
    deleteSavedPhrase,
    createCharacter,
    updateCharacter,
    deleteCharacter,
    uploadPortrait,
    getPortraitUrl,
    deletePortrait,
    createPlace,
    updatePlace,
    deletePlace,
    createEvent,
    updateEvent,
    deleteEvent,
    setEventInChapter,
    setCharacterPresent,
    setCharacterPlace,
    setPlacePresent,
    findReferences,
    renameReferences,
    exportSnapshot,
    getDriveLink,
    saveDriveLink,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
