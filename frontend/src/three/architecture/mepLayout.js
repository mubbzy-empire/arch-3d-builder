// ---------------------------------------------------------------------------
// mepLayout.js
//
// Pure, Three.js-free layout math for the MEP (electrical + plumbing)
// overlay. Kept separate from mepSystem.js's actual Three.js geometry
// building for the same reason draftingMath.js is kept separate from
// Drafting2D.jsx: it can be unit-tested directly in Node, no mocking a
// renderer.
//
// Scope, stated plainly: this places devices at real, defensible positions
// (correct AFFL heights, along the room's own actual polygon edges, routed
// from the actual distribution board / riser location) derived from the
// real building IR — not scattered decoration. It does NOT solve exact
// circuit routing through wall cavities (which wall a given room's outlet
// physically sits on, stud/joist avoidance, etc.) — that's a full MEP
// design pass, not a schematic overlay. The conduit/branch runs shown are
// the same honest "estimate" framing as estimateMEPRequirements() in
// constructionAssemblies.js, which is exactly what feeds this module's
// device counts.
// ---------------------------------------------------------------------------

export const OUTLET_HEIGHT = 0.3; // 300mm AFFL — standard socket height
export const SWITCH_HEIGHT = 1.2; // 1200mm AFFL — standard switch height

// roomCentroid deliberately is NOT redefined here. buildingModel.js already
// has the real (area-weighted) polygon centroid, verified against a
// hand-computed L-shaped-room split — a plain vertex average agrees with
// that on every rectangular room this app currently generates but silently
// diverges (and can land outside the room, right on a concave corner) the
// moment a non-rectangular room polygon exists, which a blueprint-derived
// or manually-drawn room absolutely can produce even though today's
// automated brief-to-building path only emits rectangles. Re-export it
// from here instead of re-deriving a weaker copy, so mepSystem.js and any
// future MEP code only ever have one centroid implementation to trust.
export { roomCentroid } from './buildingModel.js';

// A point offset perpendicular to a wall segment at parametric position t
// (0 at wall.start, 1 at wall.end), by `inset` metres — plain 2D vector
// arithmetic (unit direction + its perpendicular), not a rotation matrix,
// so there's no rotation-sign convention that can silently disagree with
// anything else in the renderer.
export function pointOnWallInset(wall, t, inset) {
  const [x1, z1] = wall.start;
  const [x2, z2] = wall.end;
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  const nx = -uz, nz = ux; // unit normal — one of the two perpendicular directions, sign doesn't matter for a schematic offset
  const px = x1 + dx * t, pz = z1 + dz * t;
  return [px + nx * inset, pz + nz * inset];
}

// A point at parametric position t along a room polygon edge [a, b].
export function pointOnEdge(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// Spreads `count` positions evenly around a room polygon's perimeter (by
// arc length, not by edge index — so points don't bunch up on short edges
// and thin out on long ones), each offset half a step from the previous so
// none lands exactly on a corner. Returns an array of [x, z] world points.
export function spreadPointsOnPolygon(polygon, count) {
  if (!polygon || polygon.length < 2 || count <= 0) return [];
  const edges = polygon.map((a, i) => [a, polygon[(i + 1) % polygon.length]]);
  const edgeLengths = edges.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
  const perimeter = edgeLengths.reduce((s, l) => s + l, 0) || 1;
  const points = [];
  for (let i = 0; i < count; i++) {
    const arc = ((i + 0.5) / count) * perimeter;
    let remaining = arc;
    let edgeIndex = 0;
    while (edgeIndex < edges.length - 1 && remaining > edgeLengths[edgeIndex]) {
      remaining -= edgeLengths[edgeIndex];
      edgeIndex++;
    }
    const [a, b] = edges[edgeIndex];
    const t = edgeLengths[edgeIndex] > 0 ? remaining / edgeLengths[edgeIndex] : 0.5;
    points.push(pointOnEdge(a, b, Math.min(0.98, Math.max(0.02, t))));
  }
  return points;
}

// The schematic conduit path from the distribution board to a target
// device: straight up (or down) to ceiling height, across at ceiling
// height, then down to the device — an L-shaped run through the ceiling
// void, not a literal cavity path (see module header). Returns an array of
// [x, y, z] points ready to hand to a THREE.Line.
export function conduitRunPoints(dbPos, ceilingY, targetXZ, targetY) {
  const [dbx, , dbz] = dbPos;
  const [tx, tz] = targetXZ;
  return [
    dbPos,
    [dbx, ceilingY, dbz],
    [tx, ceilingY, tz],
    [tx, targetY, tz],
  ];
}
