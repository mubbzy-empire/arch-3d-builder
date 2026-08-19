# Phase 5: Estate/compound master planning — the differentiator

Added 2026-08-18/19. This is the feature the client identified, repeatedly
and explicitly, as what separates this app from other tools: an estate
isn't N copies of the single-building tool under a bigger camera. It's a
real subdivision-style site plan.

## What changed
- `backend/services/estatePlanner.js` — was present but **completely
  non-functional**: written in ES module syntax (`export function`) inside
  a backend package whose `package.json` declares `"type": "commonjs"`.
  `require()`-ing it would have thrown a SyntaxError the instant anything
  tried — it could never have run, regardless of whether it was wired in.
  Converted to CommonJS (`module.exports`).
- **A real, confirmed geometry bug fixed inside it**: `layoutSide()` used
  a building's own `depth` for spacing consecutive plots along the road
  and `width` for the perpendicular offset from the road. Traced against
  Three.js's actual `rotation.y` matrix (not assumed) to confirm the
  opposite is true once a building is rotated ±90° to face the road: WIDTH
  becomes the along-road extent, DEPTH becomes the perpendicular extent.
  For a roughly-square building this is invisible (width ≈ depth either
  way), which is exactly how it went unnoticed — proven wrong with an
  adversarial test (a 14m-wide, 6m-deep bungalow, completely ordinary
  architecturally) where two houses on the same side of the road spine
  physically overlapped by 6 metres. Fixed and re-verified against both
  the original test data and the adversarial case, plus a realistic
  "4 bungalows + 4 wide duplexes" end-to-end simulation.
- **Output shape reconciled with what the renderer actually needs**: the
  original `planEstate()` returned `roads` as `{start:[x,z], end:[x,z]}`
  and had no `plots` array at all — incompatible with `SceneViewer.jsx`,
  which reads `road.points` (an array of two points) and `site.plots`
  (each with a `boundary`, `plotNumber`, `buildingPosition`). Wired up as
  originally written, the estate view's road-strip and dashed plot-line
  rendering would have silently rendered nothing — not crashed, just
  quietly lost the exact visual differentiation this feature exists to
  provide. Reshaped to match, and every plot now round-trips a real
  4-point boundary and a `Plot 01`-style label the same way the
  (still-defined, no-longer-active) row-grid layout already did.
- **Wired into `generateEstate()`** in `aiService.js`, replacing the
  earlier row-grid `layoutEstate()` as the active layout. `layoutEstate()`
  is kept, not deleted — fully working, fully tested, a legitimate
  alternate layout style one line away from being reachable again (e.g.
  behind a future "layout style" option), not orphaned/rotting code.
- **`SceneViewer.jsx` gained rendering for `site.greenSpace`** — the
  reserved amenity/turning-circle area the road-spine layout computes at
  its far end. This was being computed and returned by `planEstate()`
  but nothing displayed it; a paved rim + grass pad now render it, both
  optional/defensive the same way plots/roads already are (an estate
  saved under the old row-grid layout has no `greenSpace` field, and must
  keep rendering exactly as before rather than throw on `undefined.x`).
- `parseEstateMix()` (mix-request parsing, e.g. "four bungalows and four
  duplexes") had its own separate bug: `queue[queue.length % queue.length]`
  is mathematically always index 0 for any non-empty queue (n % n = 0),
  so the "cycle through the pattern to fill remaining houses" logic
  actually degenerated into "keep repeating the first item". A request
  for "one bungalow and one duplex" filled to 6 produced
  `[bungalow,duplex,bungalow,bungalow,bungalow,bungalow]` instead of the
  intended alternating pattern. Proven with an isolated numeric trace,
  fixed by capturing the original pattern length before the fill loop,
  and re-verified against 2-item and 3-item patterns.

## Verified
- `estatePlanner.js`'s `planEstate()`: no building overlaps a neighbour
  (checked in true post-rotation world space, not the pre-rotation
  footprint), no plot *boundary* overlaps another (a stricter check than
  just the buildings inside them), every building sits inside its own
  plot, buildings alternate sides of the road, the road starts exactly at
  the gate position `buildCompoundWall()` actually places it at, and
  single-building/empty-array edge cases don't crash — all re-verified
  against the final CommonJS file via `require()`, not just the pre-fix
  draft.
- `parseEstateMix()`: the exact 8-house mixed-type case, word-number vs.
  digit counts, a mix smaller than the requested total (now correctly
  cycling instead of degenerating), a mix larger than the total
  (truncates), and the no-explicit-mix fallback.
- `computeFootprint()` and the original row-grid `layoutEstate()`: real
  per-building plot sizing confirmed different between building types
  (bungalow plots measurably narrower than duplex plots, not a shared
  cell), no overlaps, buildings inside their own plots, correct gate
  alignment, oversized/single/empty edge cases.
- Confirmed the full request path end to end: `db.js`'s schema actually
  has every column the routes write to (`site_json` on `projects`,
  `buildings_json`/`site_json` on `project_versions`, every field
  `project_buildings` needs), the frontend `api/client.js` URLs match the
  backend's actual mount points exactly, and version save/restore
  correctly branches on `source_type === 'estate'` to checkpoint/restore
  all buildings + site together, not just a single `model_spec_json`.
- Full syntax sweep across `backend/` (CommonJS) and `frontend/src`
  (ESM/JSX balance), including catching that `estatePlanner.js` itself
  failed the sweep before the CommonJS conversion — the sweep's warning
  was the first real signal something was wrong, not a false positive.

## Not done here
- No UI toggle to choose between the road-spine and row-grid layout
  styles — `planEstate()` is the only one currently reachable from
  `generateEstate()`. Both are fully working; wiring a choice through is
  a small, contained follow-up, not a rebuild.
- The unused `SIDE_SETBACK` constant from the pre-fix draft was dropped
  rather than guessed into a purpose — it was declared but never
  referenced anywhere in the layout math, and inventing undocumented
  behavior for it would have been worse than removing genuinely dead code.

## Not run in a browser
Same standing limitation as every phase before this — no network here to
`npm install` the backend or frontend. Everything above was verified as
thoroughly as running the actual extracted/converted source files directly
in Node allows (not reimplementations — the real files, `require()`'d and
executed). Please run both `npm run dev`/`npm start` and generate a real
estate — ideally with a wide/shallow house type in the mix, since that's
the exact shape that exposed the overlap bug — and confirm the road,
plots, and green space all render and don't visually overlap.
