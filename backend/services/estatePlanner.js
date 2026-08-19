// ---------------------------------------------------------------------------
// estatePlanner.js
//
// PHASE 5 — real estate/compound master planning, not a grid of identical
// cells. This is the differentiator the client has repeated at the start of
// every phase: an estate isn't N copies of the single-building tool with a
// bigger camera. This module is pure logic (no DB, no AI call, no Three.js)
// so it's fully testable in plain Node.
//
// Layout produced: a single road spine running from the compound gate
// straight into the site, with each building on its own plot — sized to
// that building's real footprint, not a shared cell sized for the largest
// building in the estate — flanking the road on alternating sides, plus a
// reserved green/amenity space at the road's far end (a turning
// circle/park, the way a real cul-de-sac terminates).
//
// The gate position is NOT a free parameter here — buildCompoundWall() in
// skyEnvironment.js places the estate's gate at a fixed, deterministic
// point (x=0, z=+siteDepth/2, its default gateSide='front') and this
// planner's road spine is built to start exactly there, verified against
// that file's actual gate math rather than assumed to line up.
//
// Module format: CommonJS (`module.exports`), matching every other file in
// backend/ (package.json declares "type": "commonjs"). An earlier draft of
// this file used `export function` — valid-looking JS, but it would have
// thrown a SyntaxError the moment anything tried to require() it in this
// package, so it could never actually have run.
//
// Dimension convention, verified against Three.js's actual rotation.y
// matrix rather than assumed: a building's un-rotated footprint spans
// local x in [-width/2,width/2], z in [-depth/2,depth/2] (buildingModel.js's
// own convention). At a +-90deg rotation.y, local (x,z) maps to world
// (z,-x) — so after rotating a building to face this layout's road, its
// WIDTH becomes the along-road (Z) extent and its DEPTH becomes the
// perpendicular-to-road (X) extent. An earlier draft of layoutSide() had
// these swapped (used `depth` for the along-road spacing step and `width`
// for the perpendicular offset), which is invisible for a roughly-square
// building but produces real, confirmed overlapping houses for anything
// wide-and-shallow (e.g. a 14m-wide, 6m-deep bungalow) — proven with a
// standalone numeric test before this fix went in, not just reasoned
// about. Fixed here.
// ---------------------------------------------------------------------------

const ROAD_WIDTH = 6;
const FRONT_SETBACK = 4; // between the road edge and a building's near face
const PLOT_GAP = 2; // between consecutive plots along the same side of the road
const PERIMETER_MARGIN = 3; // between the outermost plot/road edge and the compound wall
const GREEN_SPACE_SIZE = 10; // square amenity/turning-circle area at the road's far end

// Alternates buildings onto the west (-X) and east (+X) side of the road,
// keeping each side roughly equal in count and, since building order
// already carries the AI's/offline generator's bedroom-count variation
// (the mix logic in aiService.js), roughly balanced in size too rather
// than dumping every large duplex on one side.
function splitSides(footprints) {
  const west = [], east = [];
  footprints.forEach((f, i) => (i % 2 === 0 ? west : east).push({ ...f, index: i }));
  return { west, east };
}

// Lays out one side's plots front-to-back along the road (Z axis, starting
// just past the front setback and running away from the gate) and returns
// each building's centre position, its rotation, and its plot boundary (a
// closed [[x,z],...] quadrilateral matching the shape SceneViewer.jsx's
// dashed plot-line renderer expects) for the overlap/containment tests
// this was verified against.
function layoutSide(items, sign, gateZ, roadHalfW) {
  let cursor = gateZ - FRONT_SETBACK; // first plot's near-gate edge along Z, moving away from the gate
  return items.map((item) => {
    // See the module header note: WIDTH is the along-road (Z) extent and
    // DEPTH is the perpendicular (X) extent once a building is rotated
    // +-90deg to face this layout's road — not the other way around.
    const plotWidthAlongRoad = item.width + PLOT_GAP;
    const centerZ = cursor - plotWidthAlongRoad / 2 + PLOT_GAP / 2;
    const centerX = sign * (roadHalfW + FRONT_SETBACK + item.depth / 2);
    cursor -= plotWidthAlongRoad;

    const zNear = centerZ + plotWidthAlongRoad / 2;
    const zFar = centerZ - plotWidthAlongRoad / 2;
    const xRoadEdge = sign * roadHalfW;
    const xOuter = sign * (roadHalfW + FRONT_SETBACK + item.depth + PLOT_GAP / 2);
    const xMin = Math.min(xRoadEdge, xOuter), xMax = Math.max(xRoadEdge, xOuter);

    return {
      index: item.index,
      x: centerX,
      z: centerZ,
      rotation: sign < 0 ? Math.PI / 2 : -Math.PI / 2,
      width: Math.round((xMax - xMin) * 100) / 100,
      depth: Math.round(plotWidthAlongRoad * 100) / 100,
      boundary: [[xMin, zNear], [xMax, zNear], [xMax, zFar], [xMin, zFar]],
      // Kept in true (post-rotation) X/Z terms specifically for the
      // overlap/containment tests — NOT the same axis order as the
      // building's own un-rotated {width,depth}.
      bbox: { minX: centerX - item.depth / 2, maxX: centerX + item.depth / 2, minZ: zFar, maxZ: zNear },
    };
  });
}

// Main entry point. `footprints` is an array of { width, depth } in the
// same order as the buildings they belong to — the returned `positions`
// array is in that same order so the caller can zip them back together
// without needing IDs threaded through this module. Output shape mirrors
// the row-grid layoutEstate() in aiService.js (positions + a `site` object
// carrying `plots`/`roads`/`gate`) specifically so SceneViewer.jsx and the
// estate.js persistence path need no changes to consume either layout.
function planEstate(footprints, requestedSiteWidth, requestedSiteDepth) {
  if (!footprints.length) {
    return {
      positions: [],
      site: { width: requestedSiteWidth || 40, depth: requestedSiteDepth || 40, rows: 0, cols: 0, roadWidth: ROAD_WIDTH, plots: [], roads: [], gate: { x: 0, z: (requestedSiteDepth || 40) / 2 } },
    };
  }

  const { west, east } = splitSides(footprints);
  const roadHalfW = ROAD_WIDTH / 2;

  // The road's gate end is fixed at z = +siteDepth/2 by buildCompoundWall's
  // own default gate math — but siteDepth itself depends on how deep the
  // layout ends up, which depends on the road... so this is computed in
  // two passes: lay out relative to a provisional gateZ of 0 first purely
  // to find each side's total along-road extent, then re-anchor everything
  // once the real site depth (and therefore the real gate Z) is known.
  const provisionalWest = layoutSide(west, -1, 0, roadHalfW);
  const provisionalEast = layoutSide(east, 1, 0, roadHalfW);
  const deepestSideExtent = (list) => (list.length ? Math.max(...list.map((p) => 0 - p.bbox.minZ)) : 0);
  const roadLength = Math.max(deepestSideExtent(provisionalWest), deepestSideExtent(provisionalEast)) + GREEN_SPACE_SIZE + PLOT_GAP;

  const widestPlotSpan = (list) => (list.length ? Math.max(...list.map((p) => Math.abs(p.bbox.maxX))) : roadHalfW);
  const halfWidthNeeded = Math.max(widestPlotSpan(provisionalWest), widestPlotSpan(provisionalEast)) + PERIMETER_MARGIN;

  const siteDepth = Math.max(requestedSiteDepth || 0, roadLength + FRONT_SETBACK + PERIMETER_MARGIN * 2);
  const siteWidth = Math.max(requestedSiteWidth || 0, halfWidthNeeded * 2);
  const gateZ = siteDepth / 2; // matches buildCompoundWall's default gateSide='front' exactly

  const west2 = layoutSide(west, -1, gateZ, roadHalfW);
  const east2 = layoutSide(east, 1, gateZ, roadHalfW);
  const byIndex = new Map();
  [...west2, ...east2].forEach((p) => byIndex.set(p.index, p));

  const ordered = footprints.map((_, i) => byIndex.get(i));
  const positions = ordered.map((p) => ({ x: p.x, z: p.z, rotation: p.rotation }));
  const plots = ordered.map((p, i) => ({
    plotNumber: `Plot ${String(i + 1).padStart(2, '0')}`,
    boundary: p.boundary,
    buildingPosition: [p.x, p.z],
    width: p.width,
    depth: p.depth,
  }));

  const roadFarZ = gateZ - roadLength;
  const roads = [
    { points: [[0, gateZ], [0, roadFarZ]], width: ROAD_WIDTH },
  ];

  const greenSpace = {
    x: 0,
    z: roadFarZ - GREEN_SPACE_SIZE / 2 + PLOT_GAP,
    width: GREEN_SPACE_SIZE,
    depth: GREEN_SPACE_SIZE,
  };

  return {
    positions,
    site: {
      width: siteWidth,
      depth: siteDepth,
      rows: 1, // a single road spine, not a row grid — kept for callers that display "N rows"
      cols: Math.max(west.length, east.length),
      roadWidth: ROAD_WIDTH,
      plots,
      roads,
      gate: { x: 0, z: gateZ },
      greenSpace,
    },
  };
}

module.exports = { planEstate };
