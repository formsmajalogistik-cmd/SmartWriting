// Central app store: wraps the repository, holds loaded data for the active
// project, and exposes actions. Components never touch the repository directly;
// they call these actions, which mutate via the repo and refresh local state.
import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react'
import { getRepository } from '../data/repository.js'
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
  const [activeChapterId, setActiveChapterId] = useState(
    () => localStorage.getItem(ACTIVE_CHAPTER_KEY) || null,
  )

  // Top-level navigation (which view is showing) + a card to focus when its
  // view opens (e.g. clicking a #link in the editor jumps to that card).
  const [view, setView] = useState('write')
  const [focusCard, setFocusCard] = useState(null) // { kind, id } | null

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

  // Initial load. Always reach `ready` so a load error shows the app shell
  // (with the error banner) rather than a stuck spinner.
  useEffect(() => {
    ;(async () => {
      try {
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
        const [chs] = await Promise.all([
          refreshChapters(activeProjectId),
          refreshCharacters(activeProjectId),
          refreshPlaces(activeProjectId),
          refreshLocations(activeProjectId),
          refreshEvents(activeProjectId),
        ])
        setActiveChapterId((cur) => (chs.some((c) => c.id === cur) ? cur : null))
      } catch {
        /* error already surfaced via the guarded repo */
      }
    })()
  }, [activeProjectId, refreshChapters, refreshCharacters, refreshPlaces, refreshLocations, refreshEvents])

  // Persist the active chapter so a reload reopens it.
  useEffect(() => {
    if (activeChapterId) localStorage.setItem(ACTIVE_CHAPTER_KEY, activeChapterId)
    else localStorage.removeItem(ACTIVE_CHAPTER_KEY)
  }, [activeChapterId])

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
      lexicon,
    }
  }, [activeProjectId, activeProject, chapters, characters, places, events, locations])

  // --- navigation ------------------------------------------------------
  const openCard = useCallback((kind, id) => {
    setView(kind === 'place' ? 'places' : kind === 'event' ? 'events' : 'characters')
    setFocusCard({ kind, id })
  }, [])
  const consumeFocusCard = useCallback(() => setFocusCard(null), [])

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
          await updateChapter(ch.id, { body: text })
          chaptersChanged += 1
          refsChanged += count
        }
      }
      return { chaptersChanged, refsChanged }
    },
    [chapters, updateChapter],
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
    activeChapter,
    activeChapterId,
    setActiveChapterId,
    // navigation
    view,
    setView,
    focusCard,
    openCard,
    consumeFocusCard,
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
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
