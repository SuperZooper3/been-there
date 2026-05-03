# Been There Maps Spec

## Final map decision
Been There uses MapLibre with Stadia hosted OSM basemap tiles for MVP and early phases.

## What this means
- OpenStreetMap provides the geographic source data.
- Stadia provides hosted tile delivery and style infrastructure.
- MapLibre renders the basemap plus Been There layers (H3 exploration + photo pins).

## Why this is the chosen setup
- Fastest path to a reliable MVP.
- No self-hosted map infrastructure needed at launch.
- Clean integration with MapLibre and predictable scaling path.
- Avoids Google Maps complexity and lock-in for this product type.

## Free-tier and pricing note
- Stadia generally provides starter usage suitable for development and low-volume launch.
- Pricing and quotas can change; recheck Stadia pricing before production launch.

## Local development policy
- Develop locally against Stadia hosted tiles.
- Keep local environment simple: no local tile server in MVP.
- Revisit self-hosted map tiles only if usage costs justify it later.

## Future fallback path
- If map tile cost becomes meaningful, move to Protomaps PMTiles with object storage hosting.
- This migration is an infrastructure swap, not a product redesign.

## Required production compliance
- Always display map attribution: `© OpenStreetMap contributors`.

## Alternatives considered (brief)
- Protomaps PMTiles self-hosted: excellent long-term cost control, deferred until needed.
- Google Maps: not selected due to unnecessary complexity/cost for this use case.
