# Phase 4: MEP (electrical + plumbing) as real geometry

Added 2026-08-18. Builds on `estimateMEPRequirements()` from Phase 2 (which
only produced a text/point-count estimate) with an actual visible layer:
a distribution board and per-room lighting/socket conduit runs, and a
supply riser + soil/vent stack with branch pipes into every wet room.
Off by default, toggled with a "Show MEP" button next to "Show interior"
in the single-building viewer, the same way the roof already toggles.

## What's in it
- `frontend/src/three/architecture/mepLayout.js` — pure, Three.js-free
  layout math: standard AFFL heights (300mm socket / 1200mm switch),
  a wall-inset point helper for wall-mounted devices, arc-length-based
  point spreading around a room's real perimeter (so outlets don't bunch
  on short walls and thin out on long ones), and the schematic L-shaped
  conduit path (board → ceiling → across → down to the device) used for
  every run.
- `frontend/src/three/architecture/mepSystem.js` — the actual Three.js
  geometry: a wall-mounted distribution board, a ceiling light + socket
  outlets (real per-room counts from `estimateMEPRequirements()`, not one
  placeholder per room) with dashed conduit lines back to the board, and
  for plumbing a copper supply riser + separate PVC soil/vent stack
  through every wet room's stack position, with a branch pipe and fixture
  marker into each actual bathroom/kitchen.
- Wired into `geometryBuilder.js` (`buildBuildingGroup` now always
  includes the MEP layer) and `index.js`. `ModelViewer.jsx` gained a
  "Show MEP" toggle.

## Bugs found and fixed during this pass (not shipped, then found)
- **`mepLayout.js` had its own `roomCentroid`** — a plain vertex average,
  different from the correct area-weighted one already verified in
  `buildingModel.js`. Every room this app's automated generator currently
  produces is a rectangle, where the two formulas agree exactly, which is
  exactly how this kind of bug hides — it was proven wrong with an
  L-shaped test room (naive average lands on the concave notch corner,
  outside the room; true centroid doesn't). Fixed by having `mepLayout.js`
  re-export the correct function instead of keeping a weaker duplicate,
  and verified the re-export is the literal same binding, not a copy.
- **That fix immediately exposed a second, worse bug**: the correct
  `roomCentroid` had no guard for a room with a missing `polygon` field
  and threw on `roomCentroid({})`, where the old (wrong) version had a
  defensive fallback the new one had dropped. Fixed and re-verified
  against every degenerate shape (missing/empty/1-point/2-point polygon).
- **Added guards `mepSystem.js` didn't have**: neither the electrical nor
  the plumbing builder skipped a room with no usable polygon before
  routing to it — with the centroid fix above they'd no longer crash, but
  they'd draw a fixture and a conduit/pipe run to the world origin, which
  is a worse failure mode than just skipping that room. Both now check
  polygon validity first. The plumbing riser specifically now searches
  past any wet-room entry lacking real geometry instead of taking the
  first one unconditionally and risking the entire stack landing at [0,0].
- **Caught before wiring the toggle, not after**: conduit runs are built
  as `THREE.Line` (dashed, deliberately — schematic wiring reads
  differently from a physical pipe), but `ModelViewer.jsx`'s existing
  mesh-collection traversal only ever gathered `isMesh` objects. Wired up
  as originally planned, "Show MEP" would have hidden every device box
  and pipe but left every conduit line stuck on screen permanently, with
  no way to hide it. Added a parallel `linesRef`, updated the traversal,
  and the toggle effect now handles both.
- **Caught while checking the *other* viewer, not assumed fine because
  the first one worked**: `SceneViewer.jsx` (the estate view) has no
  per-layer toggle system at all — only whole-building show/hide — but
  estate buildings run through the same `buildBuildingGroup()` that now
  always builds MEP geometry. Nothing in that file would ever have set
  MEP objects invisible, so every estate building would have shipped with
  permanently-visible conduit lines and pipes cluttering it with no way to
  turn them off. Fixed at the source instead of per-viewer: every MEP leaf
  now defaults to `.visible = false` at the point it's tagged in
  `mepSystem.js`, so "off by default" holds everywhere the geometry can
  end up, not just in the one viewer that got a dedicated button.

## Verified
- `mepLayout.js`'s pure functions were run directly in Node (no Three.js
  needed): `roomCentroid`'s divergence-then-fix was proven numerically
  against a hand-computed L-shape split, `pointOnWallInset` checked at
  t=0/t=0.5, `spreadPointsOnPolygon` checked against exact hand-predicted
  positions on a square (4 points landing exactly on the 4 edge
  midpoints) and confirmed to genuinely spread by arc length on a
  long/thin room rather than capping at one point per edge, plus
  count=0/empty-polygon/count=1 edge cases, and `conduitRunPoints`
  checked point-by-point against its documented L-shaped path.
- A full end-to-end simulation built a real two-storey house (living
  room, kitchen, two bathrooms across both floors) through the project's
  own IR constructors and confirmed: every room's placed socket count
  matches its `estimateMEPRequirements()` estimate exactly, every placed
  socket falls within its own room's bounds (not a neighbouring room or
  outside the building), the building-wide socket total matches the
  estimate's total, and wet-room detection correctly found all three
  bathrooms/kitchen across both floors.
- Full syntax sweep of every `.js` file in `frontend/src`, brace/paren/
  bracket balance re-checked on every edited `.jsx` file, and a Node-level
  proof that re-exporting the same binding from two different star-export
  paths in `index.js` doesn't collide (rather than assuming the ES module
  spec allows it).

## Known, stated scope limits (not silently papered over)
- One representative conduit run per room, not a literal run to each
  individual socket's own dedicated circuit — a full circuit diagram
  would be visual noise at this model's scale and still wouldn't
  substitute for an actual M&E engineer's drawings. Framed the same way
  `estimateMEPRequirements()` already frames itself: a defensible
  schematic, not a certified design.
- MEP risers don't currently participate in the "separate floors" story
  view — a riser spans the whole building height with no single floor to
  belong to, and the story-view code moves objects by `userData.floor`,
  so a riser stays put while floors shift apart around it. Only surfaces
  when MEP is on *and* story-view is active — both off by default — so
  left as a documented limitation rather than solved here.
- The estate view (`SceneViewer.jsx`) has no MEP toggle button of its own
  yet — MEP now correctly defaults to hidden there (see the bug list
  above) but there's no way to turn it on for an estate building the way
  there is for a single building. Real follow-up work, not done here.

## Not run in a browser
Same standing limitation as every phase before this one — no network here
to `npm install`, so nothing above was checked against an actual running
Three.js scene. Please `npm run dev`, turn "Show MEP" on for a two-storey
building with a bathroom, and confirm the conduit/pipe layer looks right
and the toggle actually shows/hides everything (including the dashed
lines, not just the boxes).
