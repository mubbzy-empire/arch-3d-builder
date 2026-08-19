# Phase 3: 2D CAD drafting module

Added 2026-08-17. The manual modeler (`/modeler`) now has a real 2D
plan-view alongside its existing 3D view — a "3D View / 2D Plan" toggle
switches between them, both reading and writing the exact same part data,
so a wall drawn in one shows up instantly in the other.

## What's in it
- `frontend/src/drafting2d/draftingMath.js` — pure, dependency-free
  geometry: world<->screen conversion, grid snap, 15° angle-lock (Shift),
  wall-from-two-points, wall-endpoint reconstruction, point-to-segment
  distance for hit-testing, door/window placement-on-wall. Every
  wall/opening formula here is the *same* formula ManualModeler's existing
  3D click-handlers already use — copied, not reinvented — so a wall drawn
  in 2D and a wall drawn in 3D are numerically indistinguishable in the
  data they produce.
- `frontend/src/drafting2d/Drafting2D.jsx` — the canvas itself: true wall
  thickness (drawn as a filled quad, not a line), always-on dimension
  labels per wall, door swing arcs and window double-lines as real plan
  symbols, live length/angle readout while drawing, grid with a heavier
  line every 5m, pan (middle-drag/Alt-drag) and zoom-to-cursor, drag-to-
  move a wall (its attached openings move with it), and the ArchiCAD-
  reference-sheet keyboard shortcuts for the tools this app actually has:
  **W**all, **D**oor, window (**H**, since W/D are taken), **S**elect,
  **Del**ete, **Ctrl+Z/Y** undo/redo, **+/-** zoom, **Home** fit-to-content.
  Deliberately does *not* bind keys for tools the data model doesn't have
  yet (columns, beams, arcs, splines) — a shortcut for a tool that doesn't
  exist would be worse than no shortcut.

## Verified (not just read)
- **`draftingMath.js`**: every wall/opening formula was compared line-by-
  line against ManualModeler's existing 3D pointer-handler code (not
  taken on faith from its own comments) and confirmed to match exactly.
  Then actually run — 19 executable test assertions covering: world<->
  screen round-trips, grid snap (incl. zero-grid passthrough, negative
  values), angle-lock at 0°/90°/45° and the zero-length/NaN case,
  wall-from-points -> endpoint-reconstruction round-trips across four wall
  orientations (horizontal/vertical/diagonal/crossing-origin), the
  degenerate zero-length-wall floor, point-to-segment distance including
  the on-segment/off-segment/beyond-endpoint/degenerate-segment cases, and
  door/window placement including out-of-bounds clamping. All 19 passed.
- **`Drafting2D.jsx`**: traced against `ManualModeler.jsx` to confirm the
  prop contract (`addPart`/`commit`/`deleteSelected`/`undo`/`redo`) matches
  exactly what's actually passed in, confirmed the 2D and 3D views' keydown
  listeners can't double-fire (only one is ever mounted, and the hidden 3D
  view's canvas doesn't receive events while `display:none`), and confirmed
  every CSS class it references is actually styled.
- **Bug found and fixed during this review, not after**: `commit`, `undo`,
  `redo`, `addPart`, and `deleteSelected` in `ManualModeler.jsx` were plain
  function expressions, recreated on every render. Since Drafting2D's main
  pointer-interaction effect lists all five as dependencies, that meant its
  ~7 DOM event listeners (mousemove/down/up, wheel, contextmenu, keydown/
  up) were torn down and rebuilt on *every* ManualModeler re-render, not
  just when something relevant changed. Not a correctness bug — the
  in-progress-drag/wall-draft state lives in refs, which survive listener
  churn — but real, needless overhead on a component that re-renders
  often. Fixed with `useCallback`, so the effect now only re-runs when
  `selectedId`/`floor`/`defaults` actually change.

## Known, stated scope limit (not silently patched over)
Dragging a wall in the 2D view translates it (and its attached openings)
but doesn't re-join it to walls it used to share a corner with — same
limitation the 3D drag tool already has. Multi-floor plan editing isn't
wired into the UI yet (`floor` is hard-coded to `1` in the ManualModeler
call site); the data model and Drafting2D component both already support
a `floor` prop, so this is a UI wiring task, not a rebuild, when it's
next in scope.

## Not run in a browser
No network/build environment here (`npm install` needs the registry).
Everything above was verified as thoroughly as static review + standalone
Node execution of the dependency-free math allows. Please `npm run dev`
and draw a few walls/doors/windows in the 2D plan, confirm they show up
correctly in the 3D view, and flag anything that looks or feels wrong.
