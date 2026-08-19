// ---------------------------------------------------------------------------
// draftingMath.js
//
// Pure, Three.js-free, DOM-free math for the 2D plan-view drafting canvas.
// Kept separate from the canvas-rendering component specifically so it can
// be unit-tested directly in Node — no browser, no mocking a <canvas>.
//
// Every wall-creation/opening-placement formula here is copied verbatim
// from ManualModeler.jsx's existing 3D pointer handlers (the wall tool's
// `rotation = Math.atan2(-dz, dx)` and the door/window tool's
// `localX = dx*cos(rot) - dz*sin(rot)` projection) — not reinvented — so a
// wall drawn in the 2D plan and a wall drawn by clicking in the 3D view
// produce numerically identical part data, and both feed the same
// buildManualMeshes() pipeline without needing to know which view made
// them.
// ---------------------------------------------------------------------------

// Screen<->world are a pure scale+offset (no rotation), so they're safe to
// hand-derive — verified by round-trip test below regardless.
export function worldToScreen(wx, wz, view) {
  return { x: view.originX + wx * view.scale, y: view.originY - wz * view.scale };
}
export function screenToWorld(sx, sy, view) {
  return { x: (sx - view.originX) / view.scale, z: (view.originY - sy) / view.scale };
}

export function snapToGrid(value, gridSize) {
  if (!gridSize) return value;
  return Math.round(value / gridSize) * gridSize;
}

// Locks a freehand (dx, dz) direction to the nearest 15° increment, keeping
// the same length — the drafting canvas's "hold Shift to lock drawing
// direction" behaviour called out in the reference cheat sheet.
export function snapAngle(dx, dz, incrementDeg = 15) {
  const length = Math.hypot(dx, dz);
  if (length < 1e-9) return { dx, dz };
  const angle = Math.atan2(dz, dx);
  const inc = (incrementDeg * Math.PI) / 180;
  const snapped = Math.round(angle / inc) * inc;
  return { dx: Math.cos(snapped) * length, dz: Math.sin(snapped) * length };
}

// Wall part from two clicked points — identical formula to ManualModeler's
// existing 3D wall tool, so 2D- and 3D-drawn walls are indistinguishable in
// the data they produce.
export function wallPartFromPoints(start, end, defaults, floor = 1) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.max(Math.hypot(dx, dz), 0.3);
  const rotation = Math.atan2(-dz, dx);
  const midX = (start.x + end.x) / 2;
  const midZ = (start.z + end.z) / 2;
  return {
    type: 'box', group: 'structure', floor,
    size: [length, defaults.wallHeight, defaults.wallThickness],
    position: [midX, defaults.wallHeight / 2, midZ],
    rotation, material: 'wood', color: '#d8cdb8',
  };
}

// The two endpoints of an already-built wall part, inverting
// wallPartFromPoints exactly (same rotation/midpoint convention), so
// selection handles and hit-testing work off the same geometry the wall
// actually renders with.
export function wallEndpoints(wall) {
  const [midX, , midZ] = wall.position;
  const half = wall.size[0] / 2;
  const rot = wall.rotation || 0;
  const dirX = Math.cos(rot), dirZ = -Math.sin(rot);
  return {
    start: { x: midX - dirX * half, z: midZ - dirZ * half },
    end: { x: midX + dirX * half, z: midZ + dirZ * half },
  };
}

export function pointToSegmentDistance(p, a, b) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const abLenSq = abx * abx + abz * abz;
  if (abLenSq < 1e-9) return Math.hypot(p.x - a.x, p.z - a.z);
  let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + abx * t, cz = a.z + abz * t;
  return Math.hypot(p.x - cx, p.z - cz);
}

// Door/window placement — identical projection formula to ManualModeler's
// existing 3D door/window tool (`localX = dx*cos(rot) - dz*sin(rot)`).
export function openingPartOnWall(wall, worldPoint, tool, defaults) {
  const [wx, , wz] = wall.position;
  const rot = wall.rotation || 0;
  const dx = worldPoint.x - wx, dz = worldPoint.z - wz;
  const localX = dx * Math.cos(rot) - dz * Math.sin(rot);
  const [openW, openH] = tool === 'door' ? defaults.doorSize : defaults.windowSize;
  const half = Math.max(wall.size[0] / 2 - openW / 2 - 0.1, 0);
  const clamped = Math.max(-half, Math.min(half, localX));
  const worldX = wx + clamped * Math.cos(rot);
  const worldZ = wz - clamped * Math.sin(rot);
  const sillY = tool === 'door' ? openH / 2 : defaults.windowSill + openH / 2;
  return {
    group: tool, wallId: wall.id, floor: wall.floor ?? 1,
    size: [openW, openH, wall.size[2]],
    position: [worldX, sillY, worldZ],
    material: tool === 'door' ? 'wood' : 'glass',
    color: tool === 'door' ? '#6b4a2f' : undefined,
  };
}
