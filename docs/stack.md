# Been There Technical Stack Spec

## Final technical choices
- Frontend: Next.js App Router on Vercel.
- Mapping: MapLibre + Stadia hosted OSM basemap.
- Spatial indexing: H3 via `h3-js`, canonical storage at res-9.
- Backend data: Supabase Postgres.
- Auth: Supabase Auth with email magic link only.
- Media: Supabase Storage for image assets.

## Phase-by-phase implementation stack

### Phase 1 - MVP
- Next.js UI and route handlers.
- Supabase Auth (magic link), Postgres, and Storage integration.
- H3 paint/erase workflow with session-scoped undo/redo.
- Polaroid-style photo pin rendering.

### Phase 2 - Foreground auto tracking
- Browser Geolocation API (`watchPosition`) while app is open.
- H3 snapping and batched cell upserts.

### Phase 3 - Route import
- GPX/Strava/Garmin import pipeline.
- Bulk H3 conversion and write path reusing the same res-9 model.

### Phase 4 - Social map layers
- Multi-user layer visibility and shared views.

### Phase 5 - Optional native background support
- Capacitor shell plus background location plugin.

## Service worker explanation (plain language)
A service worker is a browser-side helper that caches app assets and improves reliability. It makes the app load faster on repeat visits and helps with intermittent connectivity. It does not add server complexity.

## Capacitor explanation (plain language)
Capacitor wraps the existing web app into native iOS/Android projects:
1. Build web app.
2. Sync build into Capacitor.
3. Open projects in Xcode/Android Studio.
4. Test on device.
5. Optionally submit to app stores.

This is additive: backend, schema, and map logic remain the same.

## Data and media rule
- Postgres stores structured metadata.
- Images live in object storage.
- App records only storage keys/URLs in database rows.

## Alternatives considered (brief)
- Neon + separate auth/storage: not selected for MVP because integration overhead is higher.
- Firebase: not selected because SQL + H3 workflow alignment is weaker for this project.
