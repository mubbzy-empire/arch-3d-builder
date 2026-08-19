// ---------------------------------------------------------------------------
// buildingModel.js
//
// The architectural Intermediate Representation (IR) for Arch-3D.
//
// This is the structured replacement for the old "modelSpec.parts" flat
// array of disconnected boxes. Nothing in this file touches Three.js — it
// is pure data + factory/normalisation helpers. Geometry generators
// (wallSystem, roofSystem, stairSystem, geometryBuilder, ...) consume this
// shape; the AI layer (backend/services/aiService.js) should ultimately
// produce a DesignBrief that designBriefToBuilding.js turns into this shape,
// or — for blueprint input — a vision pipeline that fills it directly.
//
// Shape overview:
//
// Building
//  ├─ site            { boundary, setbacks: {front,rear,left,right} }
//  ├─ metadata         { title, style, bedrooms, ... free-form }
//  ├─ levels[]
//  │    ├─ index        (1 = ground floor, 2 = first floor, ...)
//  │    ├─ elevation     absolute Y of this level's finished floor
//  │    ├─ height        floor-to-floor / ceiling height
//  │    ├─ footprint      [[x,z], ...] polygon, CCW, in building-local coords
//  │    ├─ walls[]         see createWall()
//  │    ├─ rooms[]         see createRoom()
//  │    └─ balconies[]     [{ polygon, railingHeight, floor }]
//  ├─ stairs[]         see createStair()
//  ├─ roof             see createRoof() — always describes the TOP level's roof
//  └─ exterior         { compoundWall, gate, porch, canopy, paving, garage }
//
// Coordinate system: X = width (left/right), Z = depth (front/back),
// Y = up. Footprints/room polygons are arrays of [x, z] pairs.
// ---------------------------------------------------------------------------

let _idCounter = 0;
export function nextId(prefix = 'id') {
  _idCounter += 1;
  return `${prefix}_${_idCounter.toString(36)}`;
}

// --- Walls -------------------------------------------------------------

// A wall is a real segment, not a box. Its 3D geometry is derived from
// start/end/thickness/height/baseElevation by wallSystem.js. Openings are
// attached to the wall itself (offsetAlongWall from `start`), not placed
// independently in world space, so a window always stays embedded in its
// wall by construction.
export function createWall({
  id, start, end, thickness = 0.2, height = 3.0, baseElevation = 0,
  type = 'exterior', // 'exterior' | 'interior' | 'parapet' | 'compound'
  material = 'plaster', color, floor = 1, rooms = [], roomSpans = [], openings = [],
} = {}) {
  return {
    id: id || nextId('wall'),
    start, end, thickness, height, baseElevation,
    type, material, color, floor,
    rooms, // [roomId...] every room this wall borders — filled by the room generator
    // roomSpans: [{ room, from, to }] — the along-wall distance range (from
    // wall.start, in the same units as offsetAlongWall) that belongs to
    // each room, for walls shared by more than one room (two rooms sitting
    // side by side against the same exterior line merge into one
    // continuous wall — this is what lets a window center on ITS room's
    // stretch of that wall instead of the whole merged wall's midpoint).
    roomSpans,
    openings: openings.map((o) => normalizeOpening(o)),
  };
}

export function addOpening(wall, opening) {
  const o = normalizeOpening(opening);
  wall.openings.push(o);
  return o;
}

function normalizeOpening(o = {}) {
  const type = o.type || 'window';
  return {
    id: o.id || nextId(type),
    type, // 'window' | 'door' | 'sliding-door' | 'garage-door' | 'french-door'
    offsetAlongWall: o.offsetAlongWall ?? 0, // distance from wall.start, metres
    width: o.width ?? (type === 'door' ? 0.9 : 1.2),
    height: o.height ?? (type === 'door' ? 2.1 : 1.2),
    sillHeight: type.includes('door') ? 0 : (o.sillHeight ?? 0.9),
    style: o.style || (type.includes('door') ? 'hinged' : 'casement'),
    swing: o.swing || 'right', // hinge side for doors
    mullions: o.mullions ?? (type === 'window'),
    room: o.room || null,
  };
}

export function wallVector(wall) {
  const dx = wall.end[0] - wall.start[0];
  const dz = wall.end[1] - wall.start[1];
  return [dx, dz];
}
export function wallLength(wall) {
  const [dx, dz] = wallVector(wall);
  return Math.hypot(dx, dz);
}
export function wallAngle(wall) {
  const [dx, dz] = wallVector(wall);
  return Math.atan2(dx, dz); // radians, matches Three.js rotation.y convention used elsewhere in the app
}
export function wallMidpoint(wall) {
  return [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2];
}
// World-space point at a given distance along the wall + lateral offset
// (positive lateral = to the right when walking start→end). Used to place
// opening cutouts, and reusable by callers that need exact opening centres.
export function pointAlongWall(wall, distance, lateral = 0) {
  const len = wallLength(wall) || 1;
  const [dx, dz] = wallVector(wall);
  const ux = dx / len, uz = dz / len; // forward unit vector
  const nx = uz, nz = -ux; // right-hand normal
  return [
    wall.start[0] + ux * distance + nx * lateral,
    wall.start[1] + uz * distance + nz * lateral,
  ];
}

// --- Rooms ---------------------------------------------------------------

export function createRoom({ id, name, type = 'generic', floor = 1, polygon, ceilingHeight } = {}) {
  return { id: id || nextId('room'), name, type, floor, polygon, ceilingHeight };
}

export function roomArea(room) {
  const pts = room.polygon;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    area += x1 * z2 - x2 * z1;
  }
  return Math.abs(area) / 2;
}

// True polygon centroid (area-weighted), not a plain vertex average — for
// an L-shaped or otherwise irregular room those two disagree, and a
// vertex average can land outside the room entirely for a concave
// footprint. Used by mepSystem.js to place ceiling light points and
// route conduit/pipe branches so they land inside the actual room, not
// wherever the vertex list happens to average out to.
export function roomCentroid(room) {
  const pts = room.polygon || [];
  let signedArea = 0, cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    const cross = x1 * z2 - x2 * z1;
    signedArea += cross;
    cx += (x1 + x2) * cross;
    cz += (z1 + z2) * cross;
  }
  signedArea *= 0.5;
  if (Math.abs(signedArea) < 1e-9) {
    // Degenerate polygon (zero area) — fall back to a plain vertex average
    // rather than dividing by ~0.
    const n = pts.length || 1;
    const avgX = pts.reduce((s, p) => s + p[0], 0) / n;
    const avgZ = pts.reduce((s, p) => s + p[1], 0) / n;
    return [avgX, avgZ];
  }
  return [cx / (6 * signedArea), cz / (6 * signedArea)];
}

// --- Levels ----------------------------------------------------------------

export function createLevel({
  id, index, elevation, height = 3.0, footprint,
  walls = [], rooms = [], balconies = [], terraces = [],
} = {}) {
  return { id: id || nextId('level'), index, elevation, height, footprint, walls, rooms, balconies, terraces };
}

// --- Stairs ------------------------------------------------------------

export function createStair({
  id, fromFloor, toFloor, type = 'straight', // 'straight' | 'l-shaped' | 'u-shaped'
  position, rotation = 0, width = 1.0, riserHeight = 0.18, treadDepth = 0.28,
} = {}) {
  return { id: id || nextId('stair'), fromFloor, toFloor, type, position, rotation, width, riserHeight, treadDepth };
}

// --- Roof ------------------------------------------------------------------

export function createRoof({
  type = 'hip', // 'hip' | 'gable' | 'flat' | 'mono' | 'parapet'
  pitchDeg = 24, overhang = 0.5, parapetHeight = 0.9, ridgeAxis = 'auto',
  material = 'metal', color,
} = {}) {
  return { type, pitchDeg, overhang, parapetHeight, ridgeAxis, material, color };
}

// --- Building ----------------------------------------------------------

export function createBuilding({
  id, name = 'Building', site = {}, levels = [], stairs = [], roof, exterior = {}, metadata = {},
} = {}) {
  return {
    id: id || nextId('bldg'),
    name,
    site: { boundary: null, setbacks: { front: 3, rear: 3, left: 1.5, right: 1.5 }, ...site },
    levels,
    stairs,
    roof: roof || createRoof(),
    exterior: { compoundWall: false, gate: false, porch: false, canopy: false, paving: true, garage: null, ...exterior },
    metadata,
  };
}

// Fills in anything left implicit (elevations from heights, ids, sorted
// level order) so downstream generators never have to guard against
// missing fields. Always run a building through this before rendering.
export function normalizeBuilding(building) {
  const levels = [...building.levels].sort((a, b) => a.index - b.index);
  let runningElevation = 0;
  for (const level of levels) {
    if (level.elevation == null) level.elevation = runningElevation;
    runningElevation = level.elevation + (level.height ?? 3.0);
    for (const wall of level.walls) {
      if (wall.baseElevation == null) wall.baseElevation = level.elevation;
      if (wall.height == null) wall.height = level.height;
      if (!wall.id) wall.id = nextId('wall');
      wall.openings = wall.openings.map(normalizeOpening);
    }
    for (const room of level.rooms) {
      if (!room.id) room.id = nextId('room');
    }
  }
  return { ...building, levels };
}

export function topLevel(building) {
  return building.levels[building.levels.length - 1];
}
export function groundLevel(building) {
  return building.levels.find((l) => l.index === 1) || building.levels[0];
}
