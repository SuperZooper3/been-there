# Maps and Basemap Options

## What "OSM basemap" means
OpenStreetMap (OSM) is open geographic data. Your app still needs a map style and tile delivery service to draw roads, labels, parks, and water on screen.

In practice:
- OSM = source map data.
- Tile provider/style = how data is rendered and served to your app.
- Your H3 overlay and photo pins are your custom layers on top.

## Options for basemaps

### Option A: Hosted OSM-compatible tiles (recommended for MVP)
- Providers: Stadia Maps, MapTiler, Mapbox (OSM-derived), Carto.
- Pros:
  - Fastest to launch.
  - No infra burden.
  - Predictable pricing and docs.
- Cons:
  - Ongoing usage cost at scale.
  - Provider dependency.

### Option B: Protomaps PMTiles self-hosted (R2/S3/static hosting)
- You host one or more `.pmtiles` files and serve vector tiles yourself.
- Pros:
  - Very low long-term map serving cost.
  - Great control and portability.
  - Works well with MapLibre.
- Cons:
  - More setup than hosted tiles.
  - Need periodic data updates if freshness matters.

### Option C: Public OSM tile endpoint directly
- Not recommended for production apps with regular use.
- Pros:
  - Simple for quick local experiments.
- Cons:
  - Strict usage limits and reliability concerns.
  - Not intended as free production CDN for apps.

### Option D: Google Maps
- Pros:
  - Very mature ecosystem and SDKs.
  - Robust geocoding/routing add-ons.
- Cons:
  - Higher cost sensitivity.
  - More restrictive platform and branding requirements.
  - Not needed for your core use case (visit-cell overlay + photos).

## Recommendation by phase
- MVP: Hosted OSM-compatible tiles (Stadia or MapTiler).
- After validation: evaluate Protomaps PMTiles if costs become concern.
- Avoid Google unless you later need Google-specific services.

## Simple cost/risk framing
- Lowest setup risk now: hosted provider.
- Lowest long-term map cost: Protomaps self-hosted.
- Highest lock-in/cost risk for your current scope: Google Maps.

## Local development answer
Yes, you can run locally without "hosting too much":
- Use hosted tiles in development.
- Keep all app logic local.
- Move to PMTiles only when/if usage justifies optimization.

## Attribution reminder
Always include "© OpenStreetMap contributors" attribution when using OSM-based maps.
