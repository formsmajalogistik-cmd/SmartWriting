# SmartWriting

A multi-project writing & worldbuilding **PWA**. You sign in, create and switch
between projects, organize Books → Chapters, write in a distraction-light
Markdown editor, and capture per-chapter metadata. As of **Phase 1b**, data is
persisted in **Supabase** (Postgres + Auth) with Row Level Security; each user
sees only their own data. (Offline/local-first reconciliation comes in a later
session — the app is online-first for now.)

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

## What each part does

| Area | File(s) | Role |
|------|---------|------|
| **Supabase client** | `src/data/supabaseClient.js` | Single client from `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. Anon key only. |
| **Auth** | `src/auth/AuthProvider.jsx`, `src/components/AuthScreen.jsx` | Email/password auth, session persistence, logout, error surfacing; gates the whole app. |
| **DB migration** | `supabase/migrations/0001_init.sql` | Tables + `updated_at` triggers + RLS policies. Run manually in Supabase. |
| **Data-access interface** | `src/data/repository.js` | The single contract the UI talks to. Now wired to the Supabase implementation; the **one swap point**. |
| **Supabase implementation** | `src/data/supabaseRepository.js` | Implements the contract against Supabase: reads scoped to the active project, writes set `user_id` + `project_id`. |
| **Local implementation** | `src/data/localRepository.js`, `src/data/db.js` | Original IndexedDB implementation, kept for reference / future offline reconciliation (not wired in). |
| **Data shapes** | `src/data/types.js` | Record factories / status enum mirroring SPEC §3. |
| **App store** | `src/state/store.jsx` | React context over the repository: loads the active project's data, exposes CRUD, and now tracks a global **error** and an in-flight **saving** indicator (never fails silently). |
| **Project shell** | `src/components/ProjectSwitcher.jsx` | Create / rename / delete projects; switching scopes the whole UI. |
| **Books → Chapters tree** | `src/components/Sidebar.jsx` | Per-project sidebar tree; create/rename/delete; click to open instantly. |
| **Editor** | `src/components/Editor.jsx`, `src/components/ChapterView.jsx` | Distraction-light Markdown editor, toggleable preview, debounced save with a save-state indicator. |
| **Metadata panel** | `src/components/MetadataPanel.jsx` | Per-chapter status, POV, summary, characters present, places present, and per-character location (writes `character_locations`). |
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
chapter versioning, the provisional-name / Open Names system, and the compile
view. The Supabase swap touched only `src/data/` + auth; the UI components are
unchanged.
