# Being There Product Vision

## One-line idea
Being There is a map-based memory app where you color in places you have explored and attach photo memories to those places.

## Product recap
- Core metaphor: "Minecraft map for the real world."
- You explore real places and fill map cells as visited.
- You can drop photo pins that appear as visual memories on top of the map.
- The map works at multiple scales: street, city, California, and beyond.

## Updated MVP scope decisions
- MVP is personal-first (single user), not multi-friend layering.
- MVP uses manual drawing/filling first, not passive GPS.
- All stored visited cells are at H3 resolution 9 (fine-grained baseline).
- Map supports smooth pan/zoom in normal mode.
- Draw mode temporarily disables map panning to make painting feel precise.
- Photo pins render as polaroid-style previews (with a bottom "chin").

## Why manual-first MVP is strong
- Gives immediate value without background GPS complexity.
- Works equally well on desktop and phone.
- Lets users curate true memories rather than noisy auto logs.
- Keeps architecture compatible with later auto-fill from GPS/GPX.

## UX principles
- Fast, tactile map interaction.
- Minimal setup and no "fitness app" complexity for initial use.
- Visually rewarding progression (gray map becomes colored over time).
- Make exploration feel playful and reflective, not clinical.

## Interaction model
- **Browse mode**: map pans/zooms normally; tap pin to preview memory.
- **Draw mode**: map drag is locked; finger/mouse paint marks visited cells.
- **Erase mode**: remove accidental paint.
- **Pin mode**: tap location, upload photo, optional caption.

## Polaroid preview concept
- Slight white frame around thumbnail.
- Larger white "chin" area below image for caption/date.
- Subtle drop shadow so cards float over map.
- Card tap opens full image and details.

## Post-MVP direction
- Phase 2: foreground GPS auto-fill while app is open.
- Phase 3: GPX import (Strava/Garmin exports) before native app packaging.
- Phase 4: friend overlays / collaborative layers.
- Phase 5: native-shell background tracking (Capacitor) if still needed.
