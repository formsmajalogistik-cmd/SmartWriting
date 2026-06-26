# SmartWriting

A multi-project writing & worldbuilding **PWA**. You sign in, create and switch
between projects, organize Books → Chapters, write in a distraction-light
Markdown editor, and capture per-chapter metadata. As of **Phase 1b**, data is
persisted in **Supabase** (Postgres + Auth) with Row Level Security; each user
sees only their own data. (Offline/local-first reconciliation comes in a later
session — the app is online-first for now.)

**Phase 2** adds worldbuilding **character & place cards** (dedicated views with
rich fields stored in a `card` jsonb column), and rewires the chapter metadata
panel so characters/places present are **selected from those cards** (storing
ids, not names) rather than typed as free text. See "Worldbuilding cards
(Phase 2)" below. No new SQL is required — the `card` columns already exist from
the Phase 1b migration.

See `Ilema-App-SPEC.md` for the full multi-phase brief.

## Setup

Requires Node 18+ (developed on Node 22).

### 1. Create the database
In your Supabase project, open the **SQL Editor** and run the migration:

```
supabase/migrations/0001_init.sql
```

It creates the tables (`projects`, `chapters`, `characters`, `places`,
`character_locations`, plus deferred `events`/`routes`/`lexicon`), `updated_at`
triggers, and **enables Row Level Security with per-operation policies on every
table** (a user can only select/insert/update/delete rows where
`user_id = auth.uid()`). The script is re-runnable.

> Auth: the app uses **email + password**. In Supabase **Authentication →
> Providers**, ensure "Email" is enabled. For quick testing you may disable
> "Confirm email"; otherwise confirm the link before signing in.

### 2. Configure env
Copy the example and fill in your project's **public** values (Supabase →
Project Settings → API):

```bash
cp .env.example .env.local
# VITE_SUPABASE_URL=...      (Project URL)
# VITE_SUPABASE_ANON_KEY=... (anon public key — NOT the service_role key)
```

`.env.local` is gitignored. The **service_role key must never** go here or
anywhere in client code.

### 3. Run

```bash
npm install
npm run dev        # http://localhost:5173
# production build + preview (exercises the real PWA service worker):
npm run build
npm run preview
```

### Install as an app
Open the URL in Chrome/Edge or Safari and use **Install app / Add to Home
Screen**. The app shell is precached for fast loads; data syncs from Supabase
when online.

## Auth flow

- `AuthProvider` (`src/auth/AuthProvider.jsx`) wraps the app, subscribes to
  Supabase auth state, and keeps the session in React state. Supabase persists
  the session in `localStorage`, so a reload stays signed in.
- `main.jsx` gates rendering: while the session resolves it shows a splash;
  with **no session it renders only `AuthScreen`** (so no project data is ever
  reachable while logged out); with a session it mounts `StoreProvider` → `App`.
- `AuthScreen` does email/password sign-in & sign-up and surfaces auth errors.
  The topbar shows the signed-in email and a **Abmelden** (logout) button.

## How RLS protects the data

- Every table has `user_id` (and, except `projects`, `project_id`). RLS is
  **enabled on every table** with four explicit policies each (select / insert /
  update / delete), all keyed on `user_id = auth.uid()`. Inserts additionally
  carry a `WITH CHECK (user_id = auth.uid())`, so a client can't create rows
  owned by someone else.
- The browser only ever holds the **anon key**; the user's JWT (`auth.uid()`)
  is what the policies evaluate **server-side**. Even though the client also
  filters reads by the active project, the database is the real boundary — a
  tampered client still can't read or write another user's rows.
- Verified locally against Postgres with two simulated users: user B sees 0 of
  user A's rows, B's update/delete of A's rows affect 0 rows, and B inserting a
  row with A's `user_id` is rejected by the policy.

## Worldbuilding cards (Phase 2)

Two new top-bar views, scoped to the active project:

- **Figuren (Characters)** — a list of character cards with create / edit /
  delete. Top fields: `name`, `name_final` (toggle; a **provisional** badge
  shows while false), `role` (protagonist / antagonist / companion / minor /
  deity), `origin`, `language_name`, `status` (lebt / tot / unbekannt). Rich
  fields in `card` jsonb: who they are, what drives them, wound/loss, function
  in the story, relationships, secrets, arc per book (1/2/3), notes.
- **Orte (Places)** — list of place cards with create / edit / delete. Top
  fields: `name`, `name_final` (+ provisional badge), `region`, `place_type`,
  `language_name`. Rich `card` fields: short description, atmosphere/detail,
  significance, who lives/rules here, notes. Map coordinates are left untouched.

Both views have a **"Nur provisorische Namen"** filter — your running list of
names still to finalize — and edits autosave (debounced) through the same data
layer, with the global error / save-in-flight indicators from Phase 1b.

**Metadata panel is now select-not-type.** "Anwesende Figuren" and "Anwesende
Orte" are searchable selectors over the project's cards. Picking stores the
card **id** (never a name). Each present character gets a place dropdown
(limited to the present places) that writes/updates a `character_locations` row
`(project_id, character_id, chapter_id, place_id)`; removing a character deletes
its row. Every selector has an inline **"＋ „…“ anlegen"** that creates a
minimal stub card (name only) and selects it immediately, so writing is never
blocked — flesh the card out later in its view.

## Running without a backend (dev)

Set `VITE_DATA_BACKEND=local` to run entirely against IndexedDB with no network
and no auth gate — useful for offline development and UI testing. The default
(unset, or `supabase`) is the online-first Supabase backend with the auth gate.
Both use the identical repository interface.

## What each part does

| Area | File(s) | Role |
|------|---------|------|
| **Supabase client** | `src/data/supabaseClient.js` | Single client from `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. Anon key only. |
| **Auth** | `src/auth/AuthProvider.jsx`, `src/components/AuthScreen.jsx` | Email/password auth, session persistence, logout, error surfacing; gates the whole app. |
| **DB migration** | `supabase/migrations/0001_init.sql` | Tables + `updated_at` triggers + RLS policies. Run manually in Supabase. |
| **Data-access interface** | `src/data/repository.js` | The single contract the UI talks to. Selects Supabase (default) or the `local` IndexedDB backend via `VITE_DATA_BACKEND`; the **one swap point**. |
| **Supabase implementation** | `src/data/supabaseRepository.js` | Implements the contract against Supabase: reads scoped to the active project, writes set `user_id` + `project_id`. |
| **Local implementation** | `src/data/localRepository.js`, `src/data/db.js` | IndexedDB implementation of the same contract — the `local` dev backend / future offline reconciliation. |
| **Data shapes** | `src/data/types.js` | Record factories / status enums + Phase 2 vocabularies (`CHARACTER_ROLES`, `CHARACTER_LIFE_STATUSES`). |
| **App store** | `src/state/store.jsx` | React context over the repository: loads the active project's data, exposes CRUD (incl. `updateCharacter`/`updatePlace`), tracks a global **error** + in-flight **saving** indicator. |
| **Project shell** | `src/components/ProjectSwitcher.jsx` | Create / rename / delete projects; switching scopes the whole UI. |
| **Books → Chapters tree** | `src/components/Sidebar.jsx` | Per-project sidebar tree; create/rename/delete; click to open instantly. |
| **Editor** | `src/components/Editor.jsx`, `src/components/ChapterView.jsx` | Distraction-light Markdown editor, toggleable preview, debounced save with a save-state indicator. |
| **Cards views** | `src/components/CardsView.jsx`, `CharactersView.jsx`, `PlacesView.jsx`, `cardConfig.js` | Generic card list+editor driven by per-type field config; provisional badge, name-finalization filter, autosave. |
| **Card selectors** | `src/components/AddCombo.jsx` | Searchable add control (pick existing / create stub inline) used by the metadata panel. |
| **Metadata panel** | `src/components/MetadataPanel.jsx` | Per-chapter status, POV, summary; characters & places **selected** from cards (ids), per-character location → `character_locations`. |
| **PWA** | `vite.config.js`, `scripts/gen-icons.mjs`, `public/favicon.svg` | `vite-plugin-pwa` manifest + Workbox service worker; generated icons. |

## Data model notes

`character_locations` is the timeline backbone. A row means:

- `character_id` set, `place_id` null → character present, location not yet set
- `character_id` set, `place_id` set → character present at a place
- `character_id` null, `place_id` set → place present in the chapter (no character bound)

Books live in `projects.settings.books` (jsonb); chapters reference a book id.

## Security

- Only the **anon key** is used in the client; **no service_role key** is
  referenced anywhere in the codebase (verified by grep).
- RLS is the enforced boundary (see above).
- `.env.local` is gitignored; only `.env.example` (placeholders) is committed.

## Not yet built (later phases, per SPEC)

Offline/local-first reconciliation, 3D map, Google Drive backup, the translator,
chapter versioning, the in-prose `[[link]]` preview / Open-Names text-marker
system, and the compile view. (Phase 2's card-level `name_final` flag + filter
is the lightweight precursor to the full Open-Names view.)
