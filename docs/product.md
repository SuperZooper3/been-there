# Been There Product Spec

## Product vision
Been There is a map-memory app where users paint explored places and attach photo memories to those places. The experience feels like revealing a real-world exploration map over time.

## Product decisions (final)
- MVP is single-user and personal-first.
- Exploration data is stored as H3 visited cells at resolution 9.
- MVP input is manual drawing, not passive tracking.
- Drawing is single-cell precise paint only.
- Draw mode locks map panning to prioritize precision.
- Erase is always available.
- Undo/redo is session-scoped for the current drawing session only.
- Photo pins are displayed as polaroid-style previews with a decorative bottom chin.
- Visual palette uses warm beige neutrals plus pastel teal, pink, and orange accents.

## Core user experience
- **Browse mode**: pan/zoom map, inspect explored areas, open photo pins.
- **Draw mode**: paint exactly the touched/hovered H3 cell; map drag is locked.
- **Erase mode**: remove mistakenly painted cells.
- **Undo/redo**: step backward/forward within current draw session.
- **Pin mode**: drop a photo memory at a location with optional caption.

## Visual language
- Base map is muted and warm (beige/pastel neutral tone).
- Explored cells are color-accented and visually rewarding.
- Photo previews use a polaroid card frame and shadow treatment.
- The polaroid chin is decorative only; it does not require metadata text.

## Post-MVP product path
- Phase 2: foreground GPS auto-fill while app is open.
- Phase 3: Strava/Garmin/GPX route import and bulk backfill.
- Phase 4: social map layers and sharing.
- Phase 5: optional native packaging for passive/background tracking.

## Alternatives considered (kept brief)
- Multi-user MVP: deferred to Phase 4.
- Brush-size painting in MVP: deferred; precise single-cell paint chosen.
- Passive tracking in MVP: deferred to protect quality and delivery speed.
