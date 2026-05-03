# Been There Final Implementation Plan

## Final decisions
- Platform: Next.js web app (PWA-capable) deployed on Vercel.
- Map stack: MapLibre with Stadia hosted OSM basemap.
- Spatial model: H3, canonical storage at resolution 9.
- Backend: Supabase (Postgres, Auth, Storage).
- Auth: Google login first; email magic link fallback.
- MVP scope: single-user, manual map painting, polaroid photo pins.
- Drawing behavior: single-cell precise paint, draw-lock pan, erase always, session-only undo/redo.
- Feature order: manual MVP -> foreground GPS -> Strava/Garmin import -> social layers -> optional native background tracking.

## System architecture
- **Client**: Next.js App Router UI with map interaction modes.
- **Map rendering**: MapLibre layers for basemap, explored H3 cells, and photo pins.
- **API layer**: Next.js route handlers for auth-gated reads/writes.
- **Data**: Supabase Postgres for visited cells and photo metadata.
- **Media**: Supabase Storage for image files.

## Data model
- `users`
- `visit_cells`
  - `user_id`
  - `h3_index` (res 9)
  - `first_visited_at`
  - `last_visited_at`
  - unique index on `(user_id, h3_index)`
- `place_photos`
  - `user_id`
  - `h3_index`
  - `lat`, `lng`
  - `storage_key`
  - `caption`
  - `created_at`

## Multi-scale behavior
- Persist only res-9 visited cells.
- Derive parent cells at render/query time for zoomed-out views.
- Keep detail fidelity while still supporting city/region summaries.

## Delivery phases

### Phase 1 - MVP
- Supabase auth and user session.
- Browse, draw, erase, pin interaction modes.
- Session-scoped undo/redo in draw flows.
- Polaroid-style photo previews.
- Basic stats: visited cell count and photo count.

**Done criteria**
- User can paint, erase, undo/redo, and pin photos reliably.
- App is smooth on phone and desktop.

### Phase 2 - Foreground GPS autofill
- Add `watchPosition` tracking while app is open.
- Snap incoming points to H3 res-9 cells.
- Batch writes to reduce battery/network overhead.

### Phase 3 - Route import
- Import GPX plus Strava/Garmin exported routes.
- Convert points to H3 res-9 and bulk upsert.

### Phase 4 - Social layer
- Add optional multi-user overlays and visibility toggles.

### Phase 5 - Native background option
- Wrap app with Capacitor.
- Add background location plugin for passive tracking.

## Risks and guardrails
- H3 rendering volume can require optimization at high cell counts.
- Drawing quality is prioritized over early automation complexity.
- OSM attribution remains required in production UI.
- APIs remain portable even though Supabase is the selected platform.
