# Writing & Worldbuilding PWA — Projektbrief (für Claude Code)

A custom, multi-project writing-and-worldbuilding PWA. Its first project is the German fantasy trilogy *Die Lichter von Ilema*, but the app is **not** Ilema-specific: it hosts any number of independent projects, each with its own books, characters, places, map, and (optionally) constructed language. Drop this in the Claude Code project root as `SPEC.md` and build by phase — writing core first, 3D map last.

---

## 1. Goal & guiding principles

A single app, on desktop and mobile, that is the home of the manuscript and the worldbuilding for **multiple separate projects**. It must feel immediate — no setup ritual, no system to learn. The author never adjusts their writing style to fit the tool.

**Non-negotiables:**
- **Multi-project from day one.** Everything is scoped to an active project; a project switcher flips between worlds. Multiple books per project; multiple projects per app.
- All work auto-backs-up off-site in a **recoverable** format (Markdown for text, JSON for world data). PDFs optional as readable snapshots, never the only backup.
- Cross-device sync is automatic, not manual.
- Offline writing works; sync reconciles when back online.

---

## 2. Tech stack

- **Frontend:** React + Vite, installable PWA (service worker, offline cache). Deployed on Vercel.
- **3D map:** `react-three-fiber` + `drei` (Three.js). Low-poly stylized terrain, **per project**. Built last.
- **Backend / sync:** Supabase (Postgres + Realtime + Auth). Free tier, source of truth. NOTE: free-tier projects pause after ~1 week of inactivity — the Drive backup is the safeguard.
- **Local-first:** cache writes in IndexedDB, reconcile to Supabase; never block writing on network. Last-write-wins per record via updated-at timestamps, with a visible "unsynced changes" indicator.
- **Backup:** automatic Google Drive save (Drive API + OAuth) on a debounced timer — per-project Markdown + JSON. Optional PDF snapshots. Replaces any manual export.

---

## 3. Data model (Supabase tables)

**`projects`** is top-level. **Every other table carries `project_id`** (and `user_id`); all queries filter by the active project. Scope access with Supabase RLS on user_id.

- `projects` — id, user_id, name, created_at, settings (json: e.g. whether the conlang module is enabled).
- `chapters` — id, project_id, book, number, title, version, status (entwurf/aktiv/überarbeitung/final), pov, summary, body (Markdown), updated_at. Multiple versions may share book+number; one flagged active.
- `characters` — id, project_id, name, name_final (bool), role, origin, language_name, status, card, updated_at.
- `places` — id, project_id, name, name_final (bool), region, place_type, language_name, coords (3D position), card, updated_at.
- `character_locations` — id, project_id, character_id, chapter_id, place_id. Timeline backbone: where each character is during each chapter. Filled from chapter metadata as the author writes; the map timeline reads it; a character's route is their ordered locations.
- `events` — id, project_id, title, description, place_id, book, story_order (int), updated_at. Story beats pinned to places.
- `routes` — id, project_id, label, ordered place_ids, book. Journey lines; may derive from `character_locations`.
- `lexicon` — id, project_id, root, meaning, register, notes. Powers the per-project translator module (built late, optional per project).

---

## 4. Features, in build order

### Phase 1 — Project shell + writing core (build first)
- **Project list + switcher**; create/rename/delete a project; an active project scopes the whole UI.
- Book → chapter tree in a sidebar (per project); click to open, instant.
- Distraction-light Markdown editor; live preview optional.
- Per-chapter metadata panel: status, POV, one-line summary, characters present, places — and for each present character, **where they are this chapter** (writes a `character_locations` row). Capture from day one; it auto-fills the map timeline later.
- **Multiple versions per chapter**: duplicate, switch active, compare side by side.
- **Provisional-name marker**: a lightweight, effortless inline way to flag a name as not-final. An "Open Names" view lists every flagged occurrence across the project with context, and resolves/renames in place.
- **Compile**: assemble active chapter versions into one full-manuscript view, in book order.

### Phase 2 — Worldbuilding cards
- Character and place cards from templates, per project.
- `[[Name]]`-style linking from chapter text to cards; hover/tap preview in place.
- Per-chapter overview auto-fills from links and `character_locations`.
- Filtered views: chapters where X appears, unresolved names, chapters by status.

### Phase 3 — Interactive 3D map (build last; largest piece)
- **Per-project terrain.** No hardcoded geography: a project starts with a blank/loadable base, and the author places markers; optionally load a heightmap/terrain for that world. (Ilema's tilted-crescent continent, island capital with bridge-cities, Wanilomnir archipelago, and the Norta Markal canyon are *that project's* terrain, not the app's.)
- Clickable markers floating above terrain → open the linked place card.
- Markers **author-adjustable**: drag to reposition, edit, add — persisted to `places.coords`.
- **Chapter timeline scrubber** — the core plotting feature: scrubbing through chapters moves each character's marker to their `character_locations` place for that chapter and reveals the relevant `events`. Shows where everyone is during any chapter.
- **Route layer**: a character's or group's journey as a line from ordered locations.
- Camera: orbit + pan + zoom; mobile touch controls; performant on a phone (low-poly, limited draw calls).

### Phase 4 — Constructed-language translator (last, optional, per project)
- Enabled per project via `projects.settings`. Rule-based dictionary + morphology helper on that project's `lexicon`.
- For Ilema (Praemali): triconsonantal roots, three registers, i-a plural vowel-shift, fa- negation, three cases (nominative unmarked, accusative -en, locative -ul). NOTE: this grammar logic is Praemali-specific; do not build a universal conlang engine — other projects simply leave the module off or define their own roots.

---

## 5. Seed content (Ilema project)

Starter cards/templates exist (Amrex, Mortius, Bambam/Valkorin; places Santal Porsiran, Norta Markal; Praemali roots). Import as the **Ilema project's** initial rows. Full 104+ root lexicon lives in a separate conlang chat — import into `lexicon` (scoped to Ilema) before Phase 4.

---

## 6. Startup sequence (services)
1. New GitHub repo (e.g. `writing-app`).
2. Claude Code in that repo → scaffold **Phase 1 only** (project shell + writing core), local state first.
3. New Supabase project → Phase 1 tables (`projects`, `chapters`, `characters`, `places`, `character_locations`) with RLS on user_id; supply URL + anon key.
4. New Vercel project pointed at the repo → the deployed URL is the installable PWA per device.
   Connect one service at a time, in this order, so failures are easy to localize.

## 7. Hard reminders
- Project-scope every query and screen — getting this right now avoids a full rewrite later.
- Never risk silent cross-device data loss — always surface sync state.
- Keep the recoverable (Markdown/JSON) backup working at every phase; test that backed-up files reopen.
- Phase 3 is heavy; don't start it until Phases 1–2 are in daily use.
