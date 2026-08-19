# Phase 2 (start): Professional construction data layer

Added 2026-08-16. This is the first slice of the "rebuild into something a
professional architect would use" effort, scoped and delivered as its own
phase per the roadmap agreed with the client. Nothing existing was removed;
this is additive.

## What this adds
- `frontend/src/three/architecture/constructionAssemblies.js` (new) — a real
  construction catalog: named wall/floor/roof ASSEMBLIES (e.g. "225mm
  Sandcrete Block Wall", not just "wall, material: plaster"), each broken
  into real layers with real thicknesses and procurement units (blocks,
  m3 of concrete, m2 of render, lin.m of truss).
  - `generateBillOfQuantities(building)` — walks the actual building IR
    (walls, floors, roof) and returns real quantities grouped by trade.
    This is what "materials used" should be backed by going forward,
    instead of the AI's free-form material name list.
  - `generateConstructionSequence(building)` — the real trade sequence
    (setting out -> foundation -> DPC -> blockwork -> [suspended slab if
    upper floors] -> roofing -> first-fix M&E -> plastering -> second-fix
    M&E -> finishes -> [external works if compound wall] -> snagging),
    annotated with what happens to THIS building at each stage.
  - `estimateMEPRequirements(building)` — first-pass electrical (sockets/
    light points/switches per room, keyed off real room type + whether
    it's the master bedroom) and plumbing (supply/drain points, fixtures,
    riser requirement) derived from the building's actual rooms, not
    invented text. This directly answers the electrical/plumbing ask from
    the reference video. NOTE: this is rule-of-thumb point-counting, not
    full circuit/riser routing yet — that's the dedicated MEP phase next.
- `wallSystem.js` — every wall mesh now carries `userData.assembly` (the
  real construction name) and `userData.assemblyLayers` (the layer
  breakdown), resolved automatically from the wall's existing type/material
  tag, so no upstream caller (AI service, offline templates, manual
  modeler) needs to change to benefit.
- `PartInfoPanel.jsx` + `ModelViewer.jsx` + `SceneViewer.jsx` — clicking any
  wall in the 3D viewer now shows its real construction breakdown
  (e.g. "15mm cement render / 150mm sandcrete block / 15mm gypsum plaster")
  under the existing part-info panel, not just a paint-color label.
- `index.js` — new module exported from the architecture engine's public
  entry point.

## Verified
- Every new/edited `.js` file passed `node --check` (ESM syntax).
- Edited `.jsx` files brace/paren/bracket-balance verified.
- `generateBillOfQuantities`, `generateConstructionSequence`, and
  `estimateMEPRequirements` were run end-to-end against a hand-built
  2-room building (bedroom + bathroom, exterior + partition walls, hip
  roof, compound wall) using the project's own IR constructors
  (`createBuilding`/`createWall`/`createRoom`/...) and produced correct,
  sane output — including the master-bedroom upgrade rule and the
  compound-wall-triggered "External Works" sequence stage.
- No sandboxed network/build environment was available (same constraint
  noted in `CHANGES_2026-08-12.md`), so `npm run dev` itself was not run.
  Please smoke-test in the browser and send me anything that throws.

## Not done yet (queued, later phases)
- Wiring `generateBillOfQuantities` into the backend chat/analyze/estimate
  routes so the AI-generated "materials" list is replaced/cross-checked by
  this real engine output, and into a UI tab (currently only reachable via
  the per-wall info panel).
- 2D CAD drafting module (plan-view tools, ArchiCAD-style shortcuts).
- Full MEP routing (circuit paths, riser geometry) in the 3D view itself.
- Estate/compound master-planning differentiation.
- Blueprint-to-model detection accuracy pass.

---

## Phase 2 continued: walls now render their real layered cross-section

Previously every wall — however many construction layers its assembly had —
rendered as one flat-colored slab; the assembly data only showed up as text
in the info panel. This pass makes the geometry itself match the data:

- `wallSystem.js` now stacks each exterior/compound wall's real layers
  (render coat, block/concrete core, interior plaster — whatever
  `scaledWallLayers()` in `constructionAssemblies.js` resolves for that
  wall) as separate slabs across the wall's actual thickness, each with its
  own correct material (`materialVisualKind()` maps a layer's construction
  key to a renderer material kind). A window or door still cuts a true CSG
  opening through every one of those slabs, so the reveal at a door or
  window jamb now visually shows render/block/plaster in section, the way
  a real cut-away wall drawing does.
- Layer offsets are computed via `THREE.Quaternion`, not hand-derived trig,
  specifically so the rotation math can't silently disagree with however
  the rest of the file rotates its own box geometry.
- Interior partitions and single-layer assemblies (reinforced concrete,
  thin walls) deliberately keep the old one-slab path — splitting a
  same-finish-both-sides partition into layers would cost an extra CSG
  evaluation per opening for zero visible difference, so the added
  geometry cost is spent only on the walls where it changes what you see
  (the mobile-performance concern already flagged elsewhere in this
  codebase).
- The wall's outer `Group` now records `originalPosition`/`originalRotationY`
  itself (previously only individual meshes did), which is what
  `ModelViewer.jsx`'s "Reset positions" needs to restore a wall that was
  dragged as a whole back to its built layout.

### Verified
- Every `.js` file in `frontend/src` passed `node --check` (raw ESM
  syntax). `.jsx` files can't be checked this way (plain Node can't parse
  JSX at all, valid or not) — those were verified by brace/paren/bracket
  balance instead.
- `scaledWallLayers()` and `materialVisualKind()` were run end-to-end
  against three real wall shapes (a 225mm exterior wall with a window cut
  into it, a 100mm interior partition, and a 60mm glazed curtain wall) and
  confirmed each assembly's rescaled layers sum exactly back to that
  wall's own declared thickness, and that every construction-material key
  used anywhere in the catalog maps to a valid existing render material
  kind (no silent fallback-to-plaster on a real key).
- Still not run in an actual browser (no network/build environment here —
  `npm install` needs the registry). Please `npm run dev` and send me
  anything that throws or looks visually wrong, especially around wall
  corners and opening reveals.

---

## Phase 2 continued: stairs and floor slabs joined the same system

- `floorSystem.js` — the ground/suspended slab now resolves its real
  `FLOOR_ASSEMBLIES` spec and renders at that assembly's actual thickness
  (ground ≈280mm hardcore+DPM+slab+screed vs. suspended ≈150mm RC) instead
  of both being an identical flat 200mm guess. Room floor finishes
  (tile/marble/wood) now tag themselves with the matching real finish
  spec too, and every slab reports its construction through the same
  `userData.assembly` the info panel already reads for walls/roof.
- `stairSystem.js` — riser/tread are now checked against the standard
  residential "2R+T = 600-650mm" comfort/code range (`checkStairCompliance`,
  moved into `constructionAssemblies.js` as pure logic so the geometry and
  the quantities can't disagree) rather than silently building whatever
  was requested. Each stair run now sits on a real closed
  stringer/soffit — a solid wedge from the underside of the first riser
  down to the floor — instead of steps floating over open air. Stairs now
  have a real assembly (`STAIR_ASSEMBLIES`, reinforced concrete + tile
  finish) and, for the first time, show up in the bill of quantities.
- **Caught in review, not shipped broken:** the soffit wedge's rotation
  math was traced by hand against Three.js's actual rotation-matrix
  formula before writing it — the first version had the wedge offset
  entirely to one side and extruded in the wrong direction (verified with
  a standalone numeric check, not just visual guesswork), so it was fixed
  before going in. Noting this because it's exactly the kind of bug that
  looks fine in code review and only shows up as a stray floating shape
  in the actual 3D view.

### Verified
- `checkStairCompliance`, `assemblyForStair`, and `assemblyForFloor` were
  run against a real two-storey building built through the project's own
  IR constructors and confirmed: out-of-range riser/tread gets clamped
  with a warning, in-range passes through unchanged, the ground slab and
  suspended slab report different (correct) thicknesses, and stairs now
  appear as their own trade in `generateBillOfQuantities` with a sane
  concrete volume.
- The stair soffit wedge geometry was independently verified with a
  standalone coordinate trace against Three.js's documented rotation
  matrix (see above) — not just assumed correct from reading the code.
- Full syntax sweep of every `.js` file in `frontend/src`; every `.jsx`
  file's brace/paren/bracket balance re-checked after these edits.
- Still not run in an actual browser — please `npm run dev` and check a
  two-storey building's stairs and floor slabs visually.
