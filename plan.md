# Being There Implementation Plan

## Current direction (locked)
- Personal-first MVP (single-user experience).
- Multi-friend shared overlays are not in MVP (moved later).
- Manual draw/fill is the primary input for MVP.
- Visited cells are stored at H3 resolution 9 only.
- Polaroid-style map photo previews are in MVP.
- Draw mode locks map drag to improve painting control.
- Strava/Garmin import is prioritized before native app packaging.
- Prefer simple integrated backend path (Supabase is acceptable default).

## Product vision summary
Build a joyful exploration map where users color in real-world areas they have visited and pin visual memories. The app should feel playful and rewarding at street-level detail while still showing meaningful progress at city/regional scale.

## Architecture summary
- Client: Next.js web app + PWA behaviors.
- Map: MapLibre + OSM-compatible basemap.
- Spatial model: H3 grid, stored at resolution 9.
- Data: Postgres tables for users, visited cells, and photos.
- Media: object storage-backed photo files, referenced from DB.

## Core data model
- `users`
- `visit_cells`
  - `user_id`
  - `h3_index` (res 9)
  - `first_visited_at`
  - `last_visited_at`
  - unique key `(user_id, h3_index)`
- `place_photos`
  - `user_id`
  - `h3_index`
  - `lat`, `lng`
  - `storage_key`
  - `caption`
  - `created_at`

## Multi-scale behavior
- Store only res-9 visited cells.
- For zoomed-out views, derive parent H3 cells at query/render time.
- This preserves precision while enabling city/region summaries.

## Phase plan

## Phase 1: MVP (manual map journaling)
Scope:
- Auth + single-user account
- Browse mode map
- Draw mode (paint visited cells)
- Erase mode
- Polaroid-style photo pins
- Stats (visited cell count, photo count)
- Zoom-adaptive rendering from res-9 source

Acceptance outcomes:
- User can reliably paint visited areas and revisit memories.
- Interaction is smooth on mobile and desktop.

## Phase 2: Foreground auto-fill
Scope:
- Geolocation while app is open
- Movement-threshold based cell snapping
- Batching of updates

Acceptance outcomes:
- Walk sessions can auto-fill map with reasonable battery use.

## Phase 3: Import routes (before native app release)
Scope:
- GPX upload
- Strava/Garmin export import
- Track-to-H3 conversion and bulk upsert

Acceptance outcomes:
- User can quickly backfill past runs/walks.

## Phase 4: Social/layers
Scope:
- Multi-user overlays
- Layer toggles
- Optional sharing views

Acceptance outcomes:
- Users can compare exploration patterns with friends.

## Phase 5: Native packaging (optional)
Scope:
- Capacitor wrapper
- Background location plugin
- Optional store release

Acceptance outcomes:
- Reliable passive tracking when app is not foregrounded.

## Risks and notes
- H3 overlay performance can degrade at very high feature counts; monitor and switch rendering approach if needed.
- Drawing UX quality matters more than early automation.
- Keep APIs portable even if choosing Supabase now.
- OSM tile attribution is required.

## Decision checklist before implementation
- Confirm backend choice: Supabase default (recommended for speed).
- Confirm initial basemap provider.
- Confirm visual style palette for visited cells and polaroid cards.
- Confirm whether erase is always allowed or soft-delete only.
