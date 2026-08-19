// ---------------------------------------------------------------------------
// planGeometry.js
//
// PHASE 3 — the 2D CAD drafting module's logic layer.
//
// Deliberately has ZERO dependency on the DOM, Canvas, or React — every
// function here is plain math on plain data, the same design choice
// constructionAssemblies.js made, and for the same reason: it's the part
// that's actually possible to unit-test without a browser, and it's the
// part where a subtle bug (a snap that locks to the wrong point, a wall
// loop that closes wrong) would silently produce a wrong floor plan
// without ever throwing an error. PlanEditor.jsx (the canvas/React side)
// should stay a thin, mechanical layer on top of this file — pointer
// events in, calls into here, pixels out.
//
// A "plan" in this module is:
//   {
//     walls: [{ id, start:[x,z], end:[x,z], type, thickness, height,
//               material, openings:[{type, offsetAlongWall, width, height}] }],
//     rooms: [{ id, name, type, polygon:[[x,z],...] }],
//     floorIndex, floorHeight,
//   }
// — deliberately the same field names buildingModel.js's createWall/
// createRoom already use, so planToBuildingIR below is close to a direct
// passthrough rather than a field-by-field translation that could
// silently drop something.
// ---------------------------------------------------------------------------
import {
  createWall, createRoom, createLevel, createBuilding, createRoof, createStair,
  normalizeBuilding, wallLength,
} from '../three/architecture/buildingModel.js';

const EPS = 1e-6;

// --- Screen <-> plan (world) coordinate transform --------------------------
// Kept here, not in the canvas component, so the transform itself — the
// classic place a pan/zoom off-by-one or an axis flip hides — can be
// round-trip tested without a browser. `view` is
// { scale: pixels-per-metre, offsetX, offsetY } — plain numbers, no canvas
// or DOM object involved.
export function worldToScreen([x, z], view) {
  return [x * view.scale + view.offsetX, z * view.scale + view.offsetY];
}
export function screenToWorld([sx, sy], view) {
  return [(sx - view.offsetX) / view.scale, (sy - view.offsetY) / view.scale];
}

// --- Snapping --------------------------------------------------------------

export function snapToGrid(value, gridSize) {
  if (!gridSize) return value;
  return Math.round(value / gridSize) * gridSize;
}

// Every wall endpoint currently on the plan, deduplicated — the "magnet"
// candidates for endpoint snapping. Kept as a plain function (not cached)
// since a drafting canvas re-snaps on every pointer move and the wall
// count for a single dwelling is always small (tens, not thousands).
export function collectSnapPoints(walls) {
  const pts = [];
  for (const w of walls) {
    pts.push(w.start, w.end);
  }
  return pts;
}

// Snaps a raw cursor point (already in plan/metres space, not pixels) to
// the nearest existing wall endpoint within `snapRadius`, and failing
// that, to the grid. Returns { point:[x,z], snappedToPoint:boolean } so
// the caller can render a different snap indicator (endpoint magnet vs.
// grid snap) the way every real CAD tool distinguishes the two.
export function snapPoint(point, walls, { gridSize = 0.1, snapRadius = 0.25 } = {}) {
  const [px, pz] = point;
  let best = null, bestDist = snapRadius;
  for (const p of collectSnapPoints(walls)) {
    const d = Math.hypot(p[0] - px, p[1] - pz);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  if (best) return { point: [best[0], best[1]], snappedToPoint: true };
  return { point: [snapToGrid(px, gridSize), snapToGrid(pz, gridSize)], snappedToPoint: false };
}

// Perpendicular distance from point p to segment [a,b] — used for
// click-to-select-a-wall and for snapping a dimension/opening to the
// nearest wall rather than requiring a pixel-perfect click.
export function distanceToSegment(p, a, b) {
  const [px, pz] = p, [ax, az] = a, [bx, bz] = b;
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < EPS) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cz = az + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

// Finds the wall nearest to `point` (within `maxDist`) and the distance
// along that wall from its `start` — what buildingModel.js's
// `offsetAlongWall` needs — so a door/window placed by clicking on a wall
// in the canvas lands at the correct point on it, not just "somewhere".
export function nearestWallOffset(point, walls, maxDist = 0.3) {
  let best = null;
  for (const w of walls) {
    const d = distanceToSegment(point, w.start, w.end);
    if (d > maxDist) continue;
    const len = wallLength(w) || 1;
    const dx = w.end[0] - w.start[0], dz = w.end[1] - w.start[1];
    const ux = dx / len, uz = dz / len;
    const t = (point[0] - w.start[0]) * ux + (point[1] - w.start[1]) * uz;
    const clamped = Math.max(0, Math.min(len, t));
    if (!best || d < best.dist) best = { wall: w, offsetAlongWall: clamped, dist: d };
  }
  return best;
}

// --- Polygon helpers --------------------------------------------------------

// Signed area via the shoelace formula — positive for a counter-clockwise
// polygon in this module's (x, z) plane. buildingModel.js documents
// footprints/room polygons as authored CCW; this lets the exporter below
// guarantee that instead of hoping whatever order the user clicked in
// happened to match.
export function signedArea(polygon) {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i];
    const [x2, z2] = polygon[(i + 1) % polygon.length];
    area += x1 * z2 - x2 * z1;
  }
  return area / 2;
}

export function ensureCCW(polygon) {
  return signedArea(polygon) < 0 ? [...polygon].reverse() : polygon;
}

function keyOf(pt, precision = 3) {
  return `${pt[0].toFixed(precision)},${pt[1].toFixed(precision)}`;
}

// Attempts to trace a single closed loop out of a wall set (matching
// endpoints, snapped by rounding to `precision` decimal places so two
// walls drawn to the "same" point but with tiny floating-point drift
// still connect). Returns { footprint, ok, warning } — `ok:false` with a
// convex-hull fallback rather than throwing, because a half-finished plan
// (an open wall, a stray disconnected wall) is the normal mid-editing
// state, not an error condition the exporter should crash on.
export function closeWallLoop(walls) {
  if (walls.length < 3) {
    return { footprint: convexHull(collectSnapPoints(walls)), ok: false, warning: 'Fewer than 3 walls — not enough to form a closed room outline yet.' };
  }
  const adjacency = new Map(); // key(point) -> [{ to: point, wallId }]
  for (const w of walls) {
    const a = keyOf(w.start), b = keyOf(w.end);
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push({ to: w.end, toKey: b, wallId: w.id });
    adjacency.get(b).push({ to: w.start, toKey: a, wallId: w.id });
  }
  // A closed loop needs every vertex to have exactly degree 2 (each
  // corner meets exactly two walls). If that's not true yet (an open
  // end, or a T-junction from an interior wall included by mistake),
  // don't guess — report it and fall back.
  for (const [, edges] of adjacency) {
    if (edges.length !== 2) {
      return { footprint: convexHull(collectSnapPoints(walls)), ok: false, warning: 'Wall outline is not fully closed (an open end or a junction was found) — using an approximate outline until every corner meets exactly two walls.' };
    }
  }
  const startKey = keyOf(walls[0].start);
  const loop = [walls[0].start];
  let prevKey = null, curKey = startKey;
  let usedWallId = null;
  let guard = 0;
  while (guard++ < walls.length + 1) {
    const edges = adjacency.get(curKey);
    const next = edges.find((e) => e.toKey !== prevKey || e.wallId !== usedWallId) || edges[0];
    if (next.toKey === startKey) break; // loop closed
    loop.push(next.to);
    prevKey = curKey;
    curKey = next.toKey;
    usedWallId = next.wallId;
  }
  if (loop.length < 3) {
    return { footprint: convexHull(collectSnapPoints(walls)), ok: false, warning: 'Could not trace a closed loop from the current walls — using an approximate outline.' };
  }
  return { footprint: ensureCCW(loop), ok: true, warning: null };
}

// Simple gift-wrapping convex hull — only used as the closeWallLoop
// fallback for an incomplete plan, so it doesn't need to be more than
// "a reasonable outline to preview against", not a precise footprint.
function convexHull(points) {
  const uniq = Array.from(new Map(points.map((p) => [keyOf(p), p])).values());
  if (uniq.length < 3) return uniq;
  uniq.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return ensureCCW([...lower, ...upper]);
}

// --- Plan -> Building IR export --------------------------------------------

// Converts one drafted floor into a real Building IR level using the
// project's own buildingModel.js factories — this is the actual
// "blueprint/plan to model" bridge: everything drawn on the 2D canvas
// becomes exactly the same kind of Building object the architecture
// engine (wallSystem/roofSystem/stairSystem — the Phase 2 work) already
// knows how to turn into a professional 3D model, a bill of quantities,
// a construction sequence, and an MEP estimate. Nothing about those
// downstream systems needed to change for the 2D module to plug into them.
export function planToBuildingIR(plan, { name = 'Drafted Building', roofType = 'hip', addRoof = true } = {}) {
  const floorIndex = plan.floorIndex ?? 1;
  const floorHeight = plan.floorHeight ?? 3.0;

  const walls = plan.walls.map((w) => createWall({
    start: w.start,
    end: w.end,
    thickness: w.thickness ?? 0.225,
    height: w.height ?? floorHeight,
    type: w.type ?? 'exterior',
    material: w.material ?? 'plaster',
    color: w.color,
    floor: floorIndex,
    openings: (w.openings || []).map((o) => ({
      type: o.type,
      offsetAlongWall: o.offsetAlongWall,
      width: o.width,
      height: o.height,
      sillHeight: o.sillHeight,
    })),
  }));

  const rooms = (plan.rooms || []).map((r) => createRoom({
    name: r.name,
    type: r.type || 'generic',
    floor: floorIndex,
    polygon: ensureCCW(r.polygon),
  }));

  const exteriorWalls = walls.filter((w) => w.type === 'exterior');
  const loop = closeWallLoop(exteriorWalls.length >= 3 ? exteriorWalls : walls);

  const level = createLevel({
    index: floorIndex,
    elevation: (floorIndex - 1) * floorHeight,
    height: floorHeight,
    footprint: loop.footprint,
    walls,
    rooms,
  });

  const building = createBuilding({
    name,
    levels: [level],
    roof: addRoof ? createRoof({ type: roofType }) : createRoof({ type: 'flat', parapetHeight: 0 }),
  });

  return { building: normalizeBuilding(building), footprintWarning: loop.warning };
}

// Multi-floor variant — takes an array of per-floor plans (already sorted
// low to high) sharing the same shape as a single plan, plus stair
// connectors, and produces one Building. Kept separate from the
// single-floor path above rather than folding floor-handling into it, so
// the common single-floor case (what the editor UI drives today) stays a
// direct, easy-to-verify passthrough.
export function plansToBuildingIR(plans, { name = 'Drafted Building', roofType = 'hip', stairs = [] } = {}) {
  const levels = [];
  let warning = null;
  let runningElevation = 0;
  plans.forEach((plan, i) => {
    const floorHeight = plan.floorHeight ?? 3.0;
    const { building: single, footprintWarning } = planToBuildingIR(
      { ...plan, floorHeight, floorIndex: i + 1 },
      { name, roofType },
    );
    if (footprintWarning) warning = footprintWarning;
    const lvl = single.levels[0];
    lvl.elevation = runningElevation;
    runningElevation += floorHeight;
    levels.push(lvl);
  });
  const building = createBuilding({
    name,
    levels,
    stairs: stairs.map((s) => createStair(s)),
    roof: createRoof({ type: roofType }),
  });
  return { building: normalizeBuilding(building), footprintWarning: warning };
}
