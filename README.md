# Lumini Writing

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

### 1b. Create the portrait storage bucket
For character portraits, run the second migration in the **SQL Editor**:

```
supabase/migrations/0002_character_portraits_storage.sql
```

It creates a **private** bucket `character-portraits` (`public = false`) and
four RLS policies on `storage.objects` (select/insert/update/delete) scoped to
the owning user — object paths are `{user_id}/{character_id}/{file}`, and a
policy only allows access to objects whose first path segment equals
`auth.uid()`. Images are served via short-lived signed URLs; the bucket is never
public. The script is re-runnable.

(Equivalent UI path, if you prefer: Storage → New bucket → name
`character-portraits`, **Public = off** → then run just the policy statements
from the migration. Running the SQL file does both.)

### 1c. Add the events `card` column
For events-as-cards, run the third migration in the **SQL Editor**:

```
supabase/migrations/0003_events_card.sql
```

The `events` table already exists (from `0001_init.sql`) with `title`,
`place_id`, `book`, `story_order`, etc. and RLS. This migration only adds a
`card jsonb` column (holding `description`, `involved_character_ids`,
`chapter_ids`, `notes`). Re-runnable; no new RLS needed.

### 1d. (Optional) Google Drive backup table
Only needed if you offer the opt-in **Google Drive backup**. Run:

```
supabase/migrations/0004_drive_backup.sql
```

Creates `drive_backup` (one row per user, `user_id` primary key) holding the
opt-in flag and the Drive folder/file IDs, with RLS so a user can only see/touch
their own row. **No OAuth tokens are stored** — access tokens stay in browser
memory only. Re-runnable.

To enable the feature, also create a **Google OAuth Client ID** (Web
application) in Google Cloud Console, enable the Drive API, add your app origin
to *Authorized JavaScript origins*, and set `VITE_GOOGLE_CLIENT_ID` (see env
below). If unset, the Drive feature is simply hidden.

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

### Character portrait + physical details

The **character card only** also carries (all in the `card` jsonb — no schema
change):

- A **portrait image** at the top: upload from device, preview, replace, remove.
  Images are downscaled to ~800px on the longest side and re-encoded (WebP, JPEG
  fallback) before upload. The bytes go to a **private** Supabase Storage bucket
  (`character-portraits`); only the storage **path** is kept on the card, and
  the UI displays the image via short-lived **signed URLs**. No-image cards show
  a neutral placeholder; uploads show loading/error states.
- A compact **physical block** beneath the portrait: `age`, `species`, `height`
  (free text — e.g. "wirkt 30", "1,85 m"), a repeatable **recurring descriptors**
  list (continuity aid — add/remove individual lines), and free-text **habits**.
  The existing narrative fields (drive, wound, relationships, arc, …) follow.

Run `supabase/migrations/0002_character_portraits_storage.sql` once to create
the private bucket and its user-scoped policies (see "Storage bucket" below).
The `local` dev backend stores portrait blobs in IndexedDB instead.

**Metadata panel is now select-not-type.** "Anwesende Figuren" and "Anwesende
Orte" are searchable selectors over the project's cards. Picking stores the
card **id** (never a name). Each present character gets a place dropdown
(limited to the present places) that writes/updates a `character_locations` row
`(project_id, character_id, chapter_id, place_id)`; removing a character deletes
its row. Every selector has an inline **"＋ „…“ anlegen"** that creates a
minimal stub card (name only) and selects it immediately, so writing is never
blocked — flesh the card out later in its view.

### In-text linking (`#Name`)

In the chapter editor, typing `#` followed by characters opens an autocomplete
of matching **character** and **place** cards (👤 / 📍 icon to distinguish).
Selecting one inserts the literal text `#Name` — the Markdown stays clean and
portable, with **no hidden ids** in the prose. `#Name` (no space) is a link
token; `# ` (hash + space at line start) stays a Markdown heading.

In the **Vorschau** (preview) pane, `#Name` tokens render as links and resolve
case-insensitively (multi-word names like `#Santal Porsiran` resolve via
longest-match):

- **resolved** → indigo link; hover/tap shows a compact card preview (portrait +
  key details for a character; short description for a place) with an "open card"
  action.
- **provisional** → if the resolved card's `name_final` is false, the link is
  styled amber/dotted automatically.
- **unresolved** → if no card matches, the link is red/wavy (catches typos and
  not-yet-carded names).

**Rename safety:** renaming a card detects existing `#OldName` references across
the project's chapters and **asks for confirmation** before rewriting them to
`#NewName` — prose is never silently changed. Declined/again-missed references
simply show as unresolved.

The **Namen** view lists, project-wide, every unresolved `#reference` and every
resolved link to a not-yet-final-name card — your running "names to finalize or
fix" list, each entry linking to the chapters it appears in.

### Events (Ereignisse)

A new **Ereignisse** view (create / edit / delete event cards): `title`, `book`
+ `story_order` (timeline position), a **place** selector, an **involved
characters** multi-selector (both over existing cards, with inline create-stub),
`description`, and `notes`. The chapter metadata panel gains an **"Ereignisse in
diesem Kapitel"** multi-select; selecting an event adds the chapter to that
event's `card.chapter_ids`, linking chapters and events **both ways**. Run
`supabase/migrations/0003_events_card.sql` once (adds the `card` jsonb column).

### Editor formatting + Profile

- **Bold / italic:** the editor has a small toolbar (B / I) plus **Strg/Cmd+B**
  (`**bold**`) and **Strg/Cmd+I** (`*italic*`) shortcuts that wrap — and unwrap —
  the current selection; the preview renders both.
- **Profile tab** (account menu, top-right): change your password (Supabase
  `updateUser`, with new-password + confirm and clear success/error feedback)
  and a **"Steuerung & Syntax"** reference guide covering headings, bold, italic,
  blockquotes, lists, links, code, and `#Name` card links (incl. the resolved /
  provisional / unresolved states).
- **Icons:** all UI icons are [lucide-react](https://lucide.dev) SVGs — the app
  uses no emoji.

### Export (Export tab)

Turns the active project into downloadable files. **No SQL needed.**

**Recoverable backup — ZIP (the important part).** "ZIP exportieren" downloads
`<project>_backup.zip`:

```
<Project>/
  README.txt                         explains the bundle
  world-data.json                    full project snapshot (authoritative)
  chapters/
    01_<Book>/01_<Chapter>.md        one Markdown per chapter (book/number order)
    01_<Book>/02_<Chapter>.md
    Ohne-Buch/…                       chapters with no book
  manuscript.md                      whole manuscript compiled in book order
  portraits/<name>-<id>.<ext>        fetched copies of character portraits
```

- Each chapter `.md` has YAML frontmatter (id, title, book, book_id, number,
  status, pov, summary, characters_present, places_present) + the verbatim body.
- `world-data.json` contains project + books, **chapters (with body)**,
  characters, places, events, character_locations, and lexicon (if present). It
  is the authoritative rebuild source; the `.md` files are the readable mirror.
  A rebuild = read `world-data.json` (everything) and re-upload `portraits/*`
  (each character carries both `card.portrait_path` and the bundle-relative
  `portrait_file`).

**PDF (readability only).** Whole manuscript, a single chapter, or a
character/place card (one page, portrait + details + narrative) as cleanly
typeset PDFs. `#Name` references render as plain styled text. The UI states
plainly that **Markdown/JSON is the recoverable backup and PDF is for reading.**

**Portraits.** Exports fetch the actual image bytes (via the same signed
URL / object URL the app uses) and place them under `portraits/` — the bundle is
self-contained. If a portrait can't be fetched, the ZIP still completes and a
visible warning lists it; the JSON keeps the reference so nothing is lost
silently.

**Reusable for Drive (later).** The engine core,
`buildRecoverableBundle()` (`src/lib/export/bundle.js`), returns an in-memory
file list `[{ path, bytes, mime }]`. `bundleToZip()` turns it into a ZIP today;
the upcoming Google Drive integration can iterate the **same** list and upload
each file — no rework. The ZIP writer (fflate) and `html-to-pdfmake` are
dynamically imported on demand. The heavy PDF engine (`pdfmake` ~1.3 MB +
fonts ~855 kB) is imported via Vite `?url` and injected as a `<script>` only on
the **first PDF export** — so it is a plain static asset (not part of the JS
bundle), never loads on app startup, and is excluded from the service-worker
precache (`workbox.globIgnores`), then cached on first use so offline PDF still
works. Markdown/JSON export never touches it.

### Google Drive backup (per-user, opt-in)

In **Profil → Google Drive Backup**. **Off by default** — if a user never
connects, no backup code runs and Supabase stays the sole source of truth.

- **Connect flow.** "Mit Google Drive verbinden" uses Google Identity Services
  (browser token flow) requesting **only** the least-privilege `drive.file`
  scope (the app can see/manage only files it creates). At the consent prompt the
  user picks **which Google account** — that account's Drive is used. The opt-in
  flag is saved to `drive_backup` (per user, RLS). Only the public Client ID
  (`VITE_GOOGLE_CLIENT_ID`) is in client code — no client secret.
- **What's written & where.** Reuses the export engine: the recoverable bundle
  for the **active project** (per-chapter Markdown + `world-data.json` +
  character portraits) is pushed to `SmartWriting Backups/<project>/` in the
  user's Drive, mirroring the bundle's folder structure.
- **No duplicates.** The root folder, the per-project subfolder, and every file
  ID are stored in `drive_backup.links`; repeat backups **update the same files**
  (Drive `PATCH`) instead of creating new ones. If a stored file/folder is gone
  (e.g. the user switched accounts), it's recreated.
- **Auto + manual.** A debounced timer backs up after changes while connected
  and the token is valid; "Jetzt sichern" backs up on demand. The UI shows the
  last-backup time and in-progress / success / error / token-expired states.
- **Tokens & expiry.** Access tokens are short-lived and kept **in memory only**
  (never persisted). On expiry, a silent refresh is attempted; if it can't, the
  UI shows **"Sitzung abgelaufen — Erneut verbinden"** rather than failing
  silently or implying permanent unattended backup. "Trennen" revokes the token
  and clears the opt-in flag.
- **Per-user isolation.** `drive_backup` is RLS-scoped to `user_id = auth.uid()`
  — one user's Drive linkage is never visible or usable by another (verified
  against Postgres with two users).

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
| **Storage migration** | `supabase/migrations/0002_character_portraits_storage.sql` | Private `character-portraits` bucket + user-scoped `storage.objects` policies. Run manually. |
| **Events migration** | `supabase/migrations/0003_events_card.sql` | Adds `card jsonb` to the existing `events` table. Run manually. |
| **Drive migration** | `supabase/migrations/0004_drive_backup.sql` | Per-user `drive_backup` table (opt-in flag + Drive folder/file IDs, no tokens) with RLS. Run manually if using Drive backup. |
| **Drive backup** | `src/drive/DriveProvider.jsx`, `src/lib/drive/*` | Per-user opt-in Google Drive backup: GIS token flow (`drive.file`), REST upload/update, reuses the export bundle. Connect/disconnect + status live in Profile. |
| **Data-access interface** | `src/data/repository.js` | The single contract the UI talks to. Selects Supabase (default) or the `local` IndexedDB backend via `VITE_DATA_BACKEND`; the **one swap point**. |
| **Supabase implementation** | `src/data/supabaseRepository.js` | Implements the contract against Supabase: reads scoped to the active project, writes set `user_id` + `project_id`. |
| **Local implementation** | `src/data/localRepository.js`, `src/data/db.js` | IndexedDB implementation of the same contract — the `local` dev backend / future offline reconciliation. |
| **Data shapes** | `src/data/types.js` | Record factories / status enums + Phase 2 vocabularies (`CHARACTER_ROLES`, `CHARACTER_LIFE_STATUSES`). |
| **App store** | `src/state/store.jsx` | React context over the repository: loads the active project's data, exposes CRUD (incl. `updateCharacter`/`updatePlace`), tracks a global **error** + in-flight **saving** indicator. |
| **Project shell** | `src/components/ProjectSwitcher.jsx` | Create / rename / delete projects; switching scopes the whole UI. |
| **Books → Chapters tree** | `src/components/Sidebar.jsx` | Per-project sidebar tree; create/rename/delete; click to open instantly. |
| **Editor** | `src/components/Editor.jsx`, `src/components/ChapterView.jsx` | Distraction-light Markdown editor with `#Name` autocomplete and a bold/italic toolbar (+ Cmd/Ctrl+B/I); toggleable preview that renders resolved/provisional/unresolved links + hover card preview; debounced save. |
| **Profile** | `src/components/ProfileView.jsx` | Change-password form (Supabase `updateUser`) + a controls & Markdown/`#Name` syntax reference. |
| **Export** | `src/components/ExportView.jsx`, `src/lib/export/*` | Recoverable ZIP (Markdown + JSON + portraits) and readable PDFs. `bundle.js` is the reusable engine core (file list → ZIP / future Drive); `pdf.js` loads pdfmake on demand (`?url` + script injection) only on first PDF export. |
| **Icons** | `lucide-react` | All UI icons are lucide SVGs (no emoji anywhere). |
| **#-link engine** | `src/lib/hashlinks.js`, `src/lib/caret.js` | Token parsing/resolution, marked inline extension, rename detect/replace; caret coordinates for the autocomplete. |
| **Cards views** | `src/components/CardsView.jsx`, `CharactersView.jsx`, `PlacesView.jsx`, `cardConfig.js` | Generic card list+editor driven by per-type field config; provisional badge, name-finalization filter, autosave, rename-reference prompt. Character config adds portrait + physical fields. |
| **Events view** | `src/components/EventsView.jsx` | Event cards: title, book, story_order, place + involved-character selectors, description/notes, linked-chapter chips. |
| **Names view** | `src/components/NamesView.jsx` | Project-wide unresolved + provisional `#reference` list, linking to chapters/cards. |
| **Card preview** | `src/components/CardPreview.jsx` | Compact hover/tap preview for a resolved `#link`. |
| **Portrait** | `src/components/PortraitField.jsx`, `src/lib/image.js` | Upload/preview/replace/remove with loading+error states; downscales/compresses before upload; persists only the storage path. |
| **List field** | `src/components/ListField.jsx` | Repeatable short-entry list (recurring descriptors). |
| **Card selectors** | `src/components/AddCombo.jsx` | Searchable add control (pick existing / create stub inline) used by the metadata panel and events. |
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

Offline/local-first reconciliation, 3D map, the translator, chapter versioning,
and the compile view. Google Drive backup (per-user, opt-in) is done — see
"Google Drive backup" above. In-text `#Name` linking, the project-wide Names
view, and events-as-cards are also done; the editor links render in the
**preview pane** (the writing surface stays a fast plain textarea).
