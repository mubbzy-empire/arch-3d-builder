# Phase 6: Professional tool set for the manual 3D modeler

Added 2026-08-19, in response to the ArchiCAD reference sheet — the client
asked for the component set from the "Drawing & Design Commands" column
(shortcuts explicitly not needed) to actually exist in the manual modeler
(`/modeler`), not just the wall/door/window/box/cylinder set it had.

## What's in it
Five new tools, click-to-place in the 3D view with sensible architectural
defaults, each fully selectable/movable/rotatable/deletable/duplicable
through the existing generic part pipeline (verified, not assumed — see
below):
- **Column** — 0.3×3×0.3m concrete post.
- **Beam** — 3×0.3×0.3m concrete member, placed near ceiling height.
- **Slab** — 4×0.2×4m concrete plate at floor level (a deck/floor slab).
- **Roof** — a real hip-roof mesh (reusing `buildHipRoofMesh`, the same
  function the AI/blueprint pipeline already uses for its roofs — not an
  approximated tilted box), with its own width/footprint-depth/ridge-
  height/overhang editor in the properties panel since it doesn't use the
  generic box `size` field.
- **Zone** — a flat, semi-transparent floor-level colour wash (a new
  dedicated material, not a re-purposed glass material) for tagging a
  room/area in plan, the way a real "zone" reads as a diagram overlay
  rather than a physical object.

"Box" was relabeled "Object" to match the reference sheet's terminology —
it and Cylinder already served as the generic placeable-object tools, so
no separate redundant "Object" tool was added.

## A real bug caught before it shipped
Wiring the Roof tool into the existing renderer surfaced that
`buildHipRoofMesh` has no rotation parameter at all and hardcodes
`userData.originalRotationY = 0`. Traced through the full lifecycle (not
just the initial placement click): a user rotating a placed roof with the
gizmo would see it rotate correctly in that moment, and the rotation would
even get committed into the part's saved state — but the next full
rebuild (undo/redo, reload, switching floors) would silently snap it back
to unrotated, discarding the change with no error or indication anything
was wrong. Fixed by applying the saved rotation explicitly after building
the roof mesh, in the same routing code that wires roof parts into the
renderer, so it can't ship un-caught.

## Verified
- Confirmed via direct code tracing (not assumption) that every piece of
  existing generic part infrastructure — selection raycasting
  (`meshMapRef` populated straight from `buildManualMeshes`'s return, no
  per-group special-casing), drag-to-move/rotate commit, duplicate,
  delete, and the parts-list panel (`editor.parts.map`, no whitelist) —
  already works for any part shape with zero additional code, because
  none of it assumes a specific group or field set beyond `position`/
  `rotation`, which every new tool provides.
- Confirmed the properties panel's existing size editor is safely skipped
  for the Roof part (guarded by `selectedPart.size &&`, and a roof part
  has no `.size` field) rather than crashing, and added its own
  width/depth/ridge-height/overhang editor instead.
- Added `concrete` to both `MATERIAL_COLORS` and the material dropdown
  rather than mislabeling new concrete parts as "metal" or "wood" in the
  UI, which would have been a small but real professional-polish gap.
- 2D plan mode: confirmed the two places that gate which tools are usable
  in 2D (the toolbar filter and the auto-switch-to-Select effect) now
  share one constant (`TWOD_TOOL_IDS`) instead of two separately-written
  lists that could drift out of sync with each other.
- Full syntax sweep of every `.js` file touched, brace/paren/bracket
  balance re-checked on the edited `.jsx` files.

## Deliberately not done here (documented, not silently skipped)
The reference sheet's remaining items are real, separate features, not
small additions to this pass:
- **Polyline, Line, Arc/Circle, Spline, Fill, Text** — freeform 2D
  drafting primitives. These belong in Drafting2D.jsx (the 2D plan
  canvas, Phase 3), not the 3D modeler, and need their own drawing/
  hit-testing model the way walls already have one there.
- **A manual Dimension tool and Level Dimension marker** — Drafting2D.jsx
  already auto-dimensions every wall; a tool to place an arbitrary
  two-point dimension or a level/elevation marker is additive but
  untouched here.
- **Section, Elevation, Interior Elevation, Detail** — these aren't
  modeling tools at all; they're auto-generated 2D documentation views
  derived from the 3D model (a vertical cut, a facade view, a callout
  detail). That's a real, substantial feature on its own — closer in
  scope to Phase 3's whole 2D module than to anything addable here — not
  something to fake with a button that doesn't actually produce a
  drawing.
- **Marquee/Area Select** — the existing single-object select tool wasn't
  extended into a rubber-band multi-select in this pass.

## Not run in a browser
Same standing limitation as every phase in this project — no network
here to `npm install`. Verified by tracing every code path the new tools
touch against the actual existing infrastructure, not by re-reading and
assuming. Please `npm run dev`, place one of each new tool, confirm they
select/move/resize/delete correctly, and specifically try rotating a
placed roof and reloading to confirm the fix actually holds.
