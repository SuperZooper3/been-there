![Been There](/public/been-there-long.png)

Fill out the map by visiting places.

Been There is a map-based memory app where you color in real-world areas you've explored and drop photo pins to remember places. As you visit streets, neighborhoods, cities, and regions, explored areas light up — turning the world into a personal exploration record.

---

## Features

- **Draw mode** — paint H3 hexagon cells you've visited directly on the map; pan locks so painting stays precise
- **Erase mode** — remove cells you painted by mistake
- **Undo / Redo** — step backward and forward through your current session's draw strokes (`⌘Z` / `⌘⇧Z`)
- **Foreground GPS tracking** — tap Track to auto-fill cells as you move; a progress ring shows the current cell fill; location denial unlocks manual draw instead
- **Photo pins** — drop polaroid-style photo memories anywhere on the map with an optional caption
- **EXIF-aware uploads** — photos with GPS metadata place themselves automatically; others can be placed manually
- **Photo clusters** — nearby pins cluster at low zoom and expand as you zoom in
- **Intelligence** — sparkle toggle on the bottom bar: recency (last been), visit frequency (most been), and first visited overlays on explored cells
- **PWA** — installable on iOS and Android with full offline support, home-screen icon, and splash screen

---

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/your-username/been-there.git
cd been-there
npm install
```

### 2. Set up external services

Full step-by-step instructions are in [`docs/manual-setup.md`](docs/manual-setup.md). Summary:

| Service | What it provides | Time |
|---|---|---|
| [Supabase](https://supabase.com) | Database, email auth, and photo storage | ~10 min |
| [Stadia Maps](https://stadiamaps.com) | Map tiles — add your domain in their dashboard for production | ~2 min |
| [Vercel](https://vercel.com) | Hosting and deployment | ~5 min |

### 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Fill in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

`NEXT_PUBLIC_SITE_URL` is used to generate absolute Open Graph URLs for link previews. Stadia Maps authenticates browser apps by domain — no API key required; it works automatically on localhost and in production.

### 4. Run the database migrations

In the Supabase dashboard, go to **SQL Editor**, paste and run in order:

1. [`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql) — creates `visit_cells` and `place_photos` with row-level security (tables + policies + grants only).
2. [`supabase/migrations/002_visit_count.sql`](supabase/migrations/002_visit_count.sql) — adds `visit_count` to `visit_cells` (and drops the legacy `upsert_visit_cells_batch` function if it ever existed). Visit batch behaviour is implemented in Next.js: [`lib/visit-cells-batch.ts`](lib/visit-cells-batch.ts) and [`app/api/cells/route.ts`](app/api/cells/route.ts).

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Create an account with your email and a password — you'll be taken straight to the map.

---

## How to use the app

| Mode | How to activate | What it does |
|---|---|---|
| Browse | Tap **Browse** or press `H` | Pan and zoom freely; tap pins to open them |
| Draw | Tap **Draw** or press `P` | Drag to paint H3 cells you've visited; pan is locked |
| Erase | Tap **Erase** or press `E` | Drag to remove cells |
| Pin | Tap the camera button or press `U` | Drop a photo memory; EXIF GPS auto-places it |
| Track | Tap the **Track** button | Fills cells as you move in real time |

Undo / redo work in draw and erase modes with `⌘Z` / `⌘⇧Z` (or `Ctrl+Z` / `Ctrl+Shift+Z` on Windows).

---

## Deploying to Vercel

1. Push the repo to GitHub.
2. Import the project at [vercel.com](https://vercel.com).
3. Add the environment variables from `.env.local` in the Vercel project settings.
4. Add your Vercel deployment URL to Supabase under **Authentication › URL Configuration › Redirect URLs**.
5. Deploy.

Full details in [`docs/manual-setup.md`](docs/manual-setup.md).

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 App Router, deployed on Vercel |
| Map rendering | MapLibre GL JS |
| Map tiles | Stadia Maps (OSM-based, domain-authenticated) |
| Spatial model | H3 hexagons (`h3-js`), stored at resolution 9 |
| Database | Supabase Postgres |
| Auth | Supabase Auth (email + password) |
| Photo storage | Supabase Storage |
| Photo clustering | Supercluster |
| EXIF parsing | exifr |
| Icons | Lucide React |
| Styling | Tailwind CSS v4 |
| PWA | `next-pwa` + Web App Manifest |

---

## Data model

```
visit_cells
  user_id          uuid  → auth.users
  h3_index         text  (H3 resolution 9)
  first_visited_at timestamptz
  last_visited_at  timestamptz
  visit_count      int   (visit semantics from POST /api/cells)
  unique (user_id, h3_index)

place_photos
  user_id     uuid  → auth.users
  h3_index    text  (snapped H3 cell)
  lat, lng    float
  storage_key text
  caption     text
  created_at  timestamptz
```

Only resolution-9 cells are stored. Coarser cells for zoomed-out views are derived at render time.

---

## Project docs

| Doc | Contents |
|---|---|
| [`docs/product.md`](docs/product.md) | Product vision, UX decisions, visual style |
| [`docs/plan.md`](docs/plan.md) | Phase-by-phase implementation plan |
| [`docs/stack.md`](docs/stack.md) | Stack choices, Supabase decision, Capacitor notes |
| [`docs/maps.md`](docs/maps.md) | Basemap options and Stadia decision |
| [`docs/manual-setup.md`](docs/manual-setup.md) | Step-by-step external service setup |
| [`docs/phase1-usage.md`](docs/phase1-usage.md) | Detailed usage guide |
