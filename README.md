# Been There

Fill out the map by visiting places.

Been There is a map-based memory app where you color in real-world areas you've explored and drop photo pins to remember places. As you visit streets, neighborhoods, cities, and regions, explored areas light up — turning the world into a personal exploration record.

---

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/your-username/been-there.git
cd been-there
npm install
```

### 2. Set up external services

Before running the app you need to create accounts and configure three services. Full step-by-step instructions are in [`docs/manual-setup.md`](docs/manual-setup.md). Summary:

| Service | What it provides | Time |
|---|---|---|
| [Supabase](https://supabase.com) | Database, auth, and photo storage | ~10 min |
| [Stadia Maps](https://stadiamaps.com) | Map tiles (OSM-based, no Google) | ~2 min |
| [Vercel](https://vercel.com) | Hosting and deployment | ~5 min |

### 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Then fill in `.env.local` with values from your Supabase and Stadia dashboards:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_STADIA_API_KEY=your-stadia-key
```

The Stadia key is only required for production. Local development works without it.

### 4. Run the database migration

In the Supabase dashboard, go to **SQL Editor**, paste the contents of [`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql), and click **Run**. This creates the `visit_cells` and `place_photos` tables with row-level security.

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## How to use the app

See [`docs/phase1-usage.md`](docs/phase1-usage.md) for a full guide. Short version:

- **Browse mode** — pan and zoom freely, tap pins to open them
- **Draw mode** — drag to paint H3 hex cells you've visited (map pan locks so painting is precise)
- **Erase mode** — drag to remove mistakenly painted cells
- **Pin mode** — tap the map to drop a photo memory with optional caption
- **Undo/Redo** — `↩` / `↪` buttons (or `⌘Z` / `⌘⇧Z`) revert draw/erase strokes within the current session

---

## Deploying to Vercel

1. Push the repo to GitHub.
2. Import the project at [vercel.com](https://vercel.com).
3. Add the three environment variables from `.env.local` in the Vercel project settings.
4. Add your Vercel deployment URL to Supabase under **Authentication > URL Configuration > Redirect URLs**.
5. Deploy.

Full details in [`docs/manual-setup.md`](docs/manual-setup.md).

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js App Router on Vercel |
| Map rendering | MapLibre GL JS |
| Map tiles | Stadia Maps (OSM-based) |
| Spatial model | H3 hexagons (`h3-js`), stored at resolution 9 |
| Database | Supabase Postgres |
| Auth | Supabase Auth (Google OAuth + email magic link) |
| Photo storage | Supabase Storage |
| PWA | `next-pwa` + `public/manifest.json` |

---

## Project docs

| Doc | Contents |
|---|---|
| [`docs/product.md`](docs/product.md) | Product vision, UX decisions, visual style |
| [`docs/plan.md`](docs/plan.md) | Phase-by-phase implementation plan |
| [`docs/stack.md`](docs/stack.md) | Stack choices, Supabase decision, Capacitor notes |
| [`docs/maps.md`](docs/maps.md) | Basemap options and Stadia decision |
| [`docs/manual-setup.md`](docs/manual-setup.md) | Step-by-step external service setup |
| [`docs/phase1-usage.md`](docs/phase1-usage.md) | How to use the app |
