// ---------------------------------------------------------------------------
// designBriefToBuilding.js
//
// Deterministic space-planning engine: turns a high-level DesignBrief into
// a full architectural Building IR with real, non-uniform rooms (not an
// equal grid of cells) — a public zone (foyer/living/dining/kitchen) and a
// private zone (bedrooms/bathrooms), a stair when there's more than one
// floor, exterior/interior doors and windows sized per room type, and a
// roof over the top footprint.
//
// This is deliberately the "AI describes WHAT, engine decides HOW" boundary
// from the master spec: a DesignBrief only needs floors/bedrooms/roofType/
// features/style — everything else (wall coordinates, room polygons,
// opening placement, stair geometry) is computed here, so the AI is never
// responsible for inventing raw coordinates.
//
// DesignBrief shape:
// {
//   floors: 1-4,
//   floorHeight: 3.0,
//   footprint: { width, depth },       // ground floor footprint, metres
//   setbackPerFloor: [ {width,depth} ] // optional, one per floor above 1st
//   bedrooms: 3,
//   bathrooms: 2,                       // optional, defaults from bedrooms
//   roofType: 'hip' | 'gable' | 'flat' | 'mono',
//   style: 'modern' | 'traditional' | ...
//   features: { garage, balcony, porch, compoundWall, gate, bq }
// }
// ---------------------------------------------------------------------------
import {
  createBuilding, createLevel, createWall, addOpening, createRoom,
  createStair, createRoof, nextId,
} from './buildingModel.js';

// Splits a rectangle {x,z,width,depth} into named sub-rectangles along one
// axis by weighted ratios. direction 'h' splits along width (x), 'v' splits
// along depth (z). This is the core tool that produces realistic, unequal
// room sizes instead of a uniform grid.
function splitRect(rect, children, direction) {
  const total = children.reduce((s, c) => s + c.ratio, 0);
  const out = {};
  let cursor = direction === 'h' ? rect.x : rect.z;
  for (const child of children) {
    const span = direction === 'h'
      ? (rect.width * child.ratio) / total
      : (rect.depth * child.ratio) / total;
    out[child.key] = direction === 'h'
      ? { x: cursor, z: rect.z, width: span, depth: rect.depth }
      : { x: rect.x, z: cursor, width: rect.width, depth: span };
    cursor += span;
  }
  return out;
}

function rectPolygon(r) {
  return [[r.x, r.z], [r.x + r.width, r.z], [r.x + r.width, r.z + r.depth], [r.x, r.z + r.depth]];
}
function rectCenter(r) { return [r.x + r.width / 2, r.z + r.depth / 2]; }

// Splits a building's total bedroom/bathroom count across its floors,
// instead of giving every floor the FULL requested count (which was
// duplicating rooms — a "4-bedroom duplex" was getting 4 bedrooms
// downstairs AND 4 more upstairs). Ground floor gets a single guest
// bedroom once there's enough to spare; the rest concentrate upstairs,
// which matches how real duplexes are actually laid out.
function distributeBedrooms(total, floors) {
  if (floors === 1) return [total];
  const groundBedrooms = total >= 3 ? 1 : 0;
  const upperTotal = Math.max(1, total - groundBedrooms);
  const upperFloors = floors - 1;
  const base = Math.floor(upperTotal / upperFloors);
  const extra = upperTotal % upperFloors;
  const result = [groundBedrooms];
  for (let i = 0; i < upperFloors; i++) result.push(base + (i < extra ? 1 : 0));
  return result;
}

function distributeBathrooms(totalBathrooms, totalBedrooms, bedroomsPerFloor) {
  return bedroomsPerFloor.map((n) => (n > 0 ? Math.max(1, Math.round((totalBathrooms * n) / Math.max(1, totalBedrooms))) : 0));
}

// Lays out one floor's rooms as real rectangles (not a grid) and returns
// { rooms: {key: {rect,type,name}}, footprint }.
function planFloor({ width, depth, floorIndex, bedrooms, bathrooms, features, hasStair, isMainBedroomFloor }) {
  const footprintRect = { x: -width / 2, z: -depth / 2, width, depth };
  const rooms = {};

  if (floorIndex === 1) {
    const zones = splitRect(footprintRect, [{ key: 'public', ratio: 0.55 }, { key: 'private', ratio: 0.45 }], 'v');

    // Public zone: foyer strip + living block, living block splits into
    // living room and a dining+kitchen column.
    const pub = splitRect(zones.public, [{ key: 'foyer', ratio: 0.22 }, { key: 'main', ratio: 0.78 }], 'v');
    const main = splitRect(pub.main, [{ key: 'living', ratio: 0.6 }, { key: 'diningKitchen', ratio: 0.4 }], 'h');
    const dk = splitRect(main.diningKitchen, [{ key: 'dining', ratio: 0.5 }, { key: 'kitchenBlock', ratio: 0.5 }], 'v');
    const kb = splitRect(dk.kitchenBlock, [{ key: 'kitchen', ratio: 0.75 }, { key: 'guestToilet', ratio: 0.25 }], 'h');

    rooms.foyer = { rect: pub.foyer, type: 'foyer', name: 'Foyer' };
    rooms.living = { rect: main.living, type: 'living', name: 'Living Room' };
    rooms.dining = { rect: dk.dining, type: 'dining', name: 'Dining' };
    rooms.kitchen = { rect: kb.kitchen, type: 'kitchen', name: 'Kitchen' };
    rooms.guestToilet = { rect: kb.guestToilet, type: 'bathroom', name: 'Guest Toilet' };

    // Private zone (ground floor): stair hall (if multi-storey) + bedroom
    // wing sized to THIS floor's share of the building's total bedrooms
    // (see distributeBedrooms), not the whole-building total.
    layoutPrivateZone(rooms, zones.private, bedrooms, bathrooms, hasStair, isMainBedroomFloor);

    if (features.garage) {
      // Garage as an attached block along the front, outside the main
      // footprint width — extends the effective footprint.
      rooms.garage = { rect: { x: footprintRect.x - 4.2, z: footprintRect.z, width: 4.2, depth: 5.5 }, type: 'garage', name: 'Garage', attached: true };
    }
  } else {
    // Upper floor: family lounge + bedroom wing, with stair landing.
    const zones = splitRect(footprintRect, [{ key: 'lounge', ratio: 0.35 }, { key: 'private', ratio: 0.65 }], 'v');
    rooms.lounge = { rect: zones.lounge, type: 'lounge', name: 'Family Lounge' };
    layoutPrivateZone(rooms, zones.private, bedrooms, bathrooms, hasStair, isMainBedroomFloor);
  }

  return { rooms, footprintRect };
}

function layoutPrivateZone(rooms, zone, bedroomCount, bathroomCount, hasStair, isMainBedroomFloor) {
  const corridorRatio = hasStair ? 0.16 : 0.12;
  const split = splitRect(zone, [{ key: 'corridor', ratio: corridorRatio }, { key: 'bedWing', ratio: 1 - corridorRatio }], 'v');
  rooms.corridor = { rect: split.corridor, type: 'corridor', name: 'Hallway' };

  // A floor with no bedrooms allotted to it (typically the ground floor of
  // a duplex, once the upper floor(s) carry the bulk of the bedrooms) gets
  // a store room instead of a phantom bedroom that was never requested.
  if (bedroomCount <= 0) {
    rooms.store = { rect: split.bedWing, type: 'store', name: 'Store' };
    return;
  }

  const n = bedroomCount;
  const weights = Array.from({ length: n }, (_, i) => (i === 0 ? 1.4 : 1)); // master bedroom larger
  const bedChildren = weights.map((w, i) => ({ key: `bed${i}`, ratio: w }));
  const bedSlots = splitRect(split.bedWing, bedChildren, 'h');

  const bathsToPlace = Math.max(bathroomCount > 0 ? 1 : 0, bathroomCount ?? Math.ceil(n / 2));
  let bathsPlaced = 0;
  Object.entries(bedSlots).forEach(([key, rect], i) => {
    const isMaster = i === 0 && isMainBedroomFloor;
    const isFirstOnFloor = i === 0;
    const needsEnsuite = bathsToPlace > 0 && (isFirstOnFloor || bathsPlaced < bathsToPlace - 1);
    if (needsEnsuite && bathsPlaced < bathsToPlace) {
      const withBath = splitRect(rect, [{ key: 'bed', ratio: 0.72 }, { key: 'bath', ratio: 0.28 }], 'h');
      rooms[key] = { rect: withBath.bed, type: 'bedroom', name: isMaster ? 'Master Bedroom' : `Bedroom ${i + 1}` };
      rooms[`${key}_bath`] = { rect: withBath.bath, type: 'bathroom', name: isMaster ? 'Master Ensuite' : `Bathroom ${bathsPlaced + 1}` };
      bathsPlaced += 1;
    } else {
      rooms[key] = { rect, type: 'bedroom', name: isMaster ? 'Master Bedroom' : `Bedroom ${i + 1}` };
    }
  });
}

// Converts the planned rooms (rectangles) into real wall segments, deduping
// shared edges between adjacent rooms into a single interior wall, and
// tagging footprint-boundary edges as exterior.
// Builds real, continuous wall segments from a floor's room rectangles.
//
// The naive approach (one wall per room-polygon edge, merging only when two
// edges share exact endpoints) fails whenever adjacent rooms are different
// sizes — e.g. two bedrooms side by side against the back wall each
// contribute a short edge that SHOULD merge into one continuous wall, but
// their endpoints don't coincide (the wall between them and the corridor is
// full-width, but each bedroom's own edge is only its own width), so they
// never merged and produced dozens of short, disconnected wall fragments
// instead of clean room boundaries.
//
// This version groups every room edge by which line it sits on (its
// orientation — running along X at a fixed Z, or along Z at a fixed X —
// plus that fixed coordinate), then merges touching/overlapping intervals
// on each line into single continuous runs the way you'd merge overlapping
// calendar bookings. Each merged run becomes exactly one wall, with a
// roomSpan recorded per room that contributed to it so doors/windows can
// still be centered on their own room's stretch of a shared wall.
function wallsFromRooms(rooms, footprintRect, floorIndex, elevation, height) {
  const EPS = 0.03; // bridges floating-point rounding between touching rects, not real gaps
  const groupsX = new Map(); // constant Z -> [{room, min, max}]  (edge runs along X)
  const groupsZ = new Map(); // constant X -> [{room, min, max}]  (edge runs along Z)
  const roundKey = (v) => Math.round(v / EPS) * EPS;

  Object.values(rooms).forEach((room) => {
    if (room.attached) return; // garage handled separately with its own exterior walls
    const r = room.rect;
    const edges = [
      { orient: 'x', at: r.z, min: r.x, max: r.x + r.width },
      { orient: 'x', at: r.z + r.depth, min: r.x, max: r.x + r.width },
      { orient: 'z', at: r.x, min: r.z, max: r.z + r.depth },
      { orient: 'z', at: r.x + r.width, min: r.z, max: r.z + r.depth },
    ];
    for (const e of edges) {
      if (e.max - e.min < 0.05) continue;
      const map = e.orient === 'x' ? groupsX : groupsZ;
      const k = roundKey(e.at);
      if (!map.has(k)) map.set(k, { at: e.at, entries: [] });
      map.get(k).entries.push({ room: room.name, min: e.min, max: e.max });
    }
  });

  const isOnFootprintBoundary = (orient, at) => (orient === 'x'
    ? Math.abs(at - footprintRect.z) < 0.1 || Math.abs(at - (footprintRect.z + footprintRect.depth)) < 0.1
    : Math.abs(at - footprintRect.x) < 0.1 || Math.abs(at - (footprintRect.x + footprintRect.width)) < 0.1);

  const walls = [];
  const buildFromGroup = (map, orient) => {
    for (const { at, entries } of map.values()) {
      // Merge overlapping/touching intervals on this line into runs.
      const sorted = [...entries].sort((a, b) => a.min - b.min);
      const runs = [];
      for (const e of sorted) {
        const last = runs[runs.length - 1];
        if (last && e.min <= last.max + EPS) {
          last.max = Math.max(last.max, e.max);
          last.members.push(e);
        } else {
          runs.push({ min: e.min, max: e.max, members: [e] });
        }
      }

      const exterior = isOnFootprintBoundary(orient, at);
      for (const run of runs) {
        if (run.max - run.min < 0.1) continue;
        const start = orient === 'x' ? [run.min, at] : [at, run.min];
        const end = orient === 'x' ? [run.max, at] : [at, run.max];
        const roomSpans = run.members.map((m) => ({
          room: m.room,
          from: Math.max(m.min, run.min) - run.min,
          to: Math.min(m.max, run.max) - run.min,
        }));
        walls.push(createWall({
          start, end,
          thickness: exterior ? 0.2 : 0.12,
          height, baseElevation: elevation,
          type: exterior ? 'exterior' : 'interior',
          material: 'plaster',
          floor: floorIndex,
          rooms: [...new Set(roomSpans.map((s) => s.room))],
          roomSpans,
        }));
      }
    }
  };
  buildFromGroup(groupsX, 'x');
  buildFromGroup(groupsZ, 'z');
  return walls;
}

function addWindowsAndDoors(walls, rooms, floorIndex, isGroundFloor) {
  const wallsByRoom = new Map();
  for (const wall of walls) {
    for (const roomName of wall.rooms) {
      if (!wallsByRoom.has(roomName)) wallsByRoom.set(roomName, []);
      wallsByRoom.get(roomName).push(wall);
    }
  }
  // The along-wall centre and available span of a specific room's own
  // stretch of a (possibly shared/merged) wall — this is what lets a
  // window sit centred on ITS room rather than the whole merged wall.
  const roomSpanOn = (wall, roomName) => {
    const span = wall.roomSpans.find((s) => s.room === roomName);
    if (!span) {
      const len = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
      return { center: len / 2, length: len };
    }
    return { center: (span.from + span.to) / 2, length: span.to - span.from };
  };

  const windowSizeByType = {
    living: { width: 2.4, height: 1.6, sill: 0.6, sliding: true },
    dining: { width: 1.6, height: 1.4, sill: 0.75 },
    kitchen: { width: 1.2, height: 1.0, sill: 1.1 },
    bedroom: { width: 1.4, height: 1.3, sill: 0.9 },
    lounge: { width: 2.0, height: 1.5, sill: 0.7 },
    bathroom: { width: 0.5, height: 0.5, sill: 1.6 },
  };

  Object.values(rooms).forEach((room) => {
    const preset = windowSizeByType[room.type];
    if (!preset) return;
    const roomWalls = wallsByRoom.get(room.name) || [];
    const extWall = roomWalls.find((w) => w.type === 'exterior');
    if (!extWall) return;
    const { center, length } = roomSpanOn(extWall, room.name);
    const width = Math.min(preset.width, length - 0.4);
    if (width < 0.35) return;
    addOpening(extWall, {
      type: preset.sliding ? 'sliding-door' : 'window',
      offsetAlongWall: center,
      width, height: preset.height, sillHeight: preset.sliding ? 0 : preset.sill,
      room: room.name,
    });
  });

  // Entrance door on the foyer's (or lounge's, upper floor) exterior wall.
  // Entrance door only belongs on the ground floor. Without this check,
  // every upper floor fell through to `rooms.lounge` (there's no foyer
  // above ground level) and got a phantom "entrance door" stacked at the
  // exact same position as that room's own window — two overlapping CSG
  // cutter boxes subtracted from the same wall, which is exactly the kind
  // of degenerate case that corrupts geometry (this produced the "walls
  // extending far beyond the house" symptom).
  const entranceRoom = isGroundFloor ? rooms.foyer : null;
  if (entranceRoom) {
    const roomWalls = wallsByRoom.get(entranceRoom.name) || [];
    const extWall = roomWalls.find((w) => w.type === 'exterior');
    if (extWall) {
      const { center } = roomSpanOn(extWall, entranceRoom.name);
      addOpening(extWall, { type: 'door', offsetAlongWall: center, width: 1.1, height: 2.1, room: entranceRoom.name });
    }
  }

  // Interior circulation doors: every private/service room gets a door on
  // whichever interior wall it shares with the corridor (or living/foyer on
  // the ground floor public side, since there's no corridor there).
  const circulationNames = [rooms.corridor?.name, rooms.foyer?.name, rooms.living?.name, rooms.lounge?.name].filter(Boolean);
  Object.values(rooms).forEach((room) => {
    if (['bedroom', 'bathroom', 'kitchen', 'store'].indexOf(room.type) === -1) return;
    const roomWalls = wallsByRoom.get(room.name) || [];
    const doorWall = roomWalls.find((w) => w.type === 'interior' && w.rooms.some((rn) => circulationNames.includes(rn)));
    const fallback = roomWalls.find((w) => w.type === 'interior');
    const wall = doorWall || fallback;
    if (!wall) return;
    const { center, length } = roomSpanOn(wall, room.name);
    const width = room.type === 'bathroom' ? 0.75 : 0.85;
    if (length < width + 0.3) return;
    addOpening(wall, { type: 'door', offsetAlongWall: center, width, height: 2.05, room: room.name });
  });
}

function buildGarageWalls(garageRect, footprintRect, floorIndex, elevation, height) {
  const poly = rectPolygon(garageRect);
  const walls = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    walls.push(createWall({ start: a, end: b, thickness: 0.2, height, baseElevation: elevation, type: 'exterior', floor: floorIndex, rooms: ['Garage'] }));
  }
  // Garage door on the wall facing away from the house (the outer long side).
  const frontWall = walls[2]; // far edge from footprint, opposite the shared wall
  const len = Math.hypot(frontWall.end[0] - frontWall.start[0], frontWall.end[1] - frontWall.start[1]);
  addOpening(frontWall, { type: 'garage-door', offsetAlongWall: len / 2, width: Math.min(2.6, len - 0.3), height: 2.2, room: 'Garage' });
  return walls;
}

export function generateBuildingFromBrief(brief) {
  const {
    floors = 1, floorHeight = 3.0, footprint = { width: 12, depth: 10 },
    setbackPerFloor = [], bedrooms = 3, bathrooms, roofType = 'hip', style = 'modern',
    features = {},
  } = brief;

  const levels = [];
  let elevation = 0;
  let prevFootprint = footprint;
  const bedroomsPerFloor = distributeBedrooms(bedrooms, floors);
  const bathroomsPerFloor = distributeBathrooms(bathrooms ?? Math.max(1, Math.ceil(bedrooms / 2)), bedrooms, bedroomsPerFloor);
  // The master suite goes on whichever floor carries the most bedrooms
  // (ties favour the higher floor — master upstairs is the more common
  // real layout), not automatically floor 1.
  const mainBedroomFloorIndex = bedroomsPerFloor.reduce(
    (best, n, i) => (n >= bedroomsPerFloor[best] ? i : best), 0,
  ) + 1;

  for (let f = 1; f <= floors; f++) {
    // No explicit setback for this floor => same footprint as the floor
    // below (a real duplex is not required to step back). Only shrink when
    // the brief actually specified a setback for this floor.
    const fp = f === 1 ? footprint : (setbackPerFloor[f - 2] || prevFootprint);
    const hasStair = floors > 1;
    const { rooms, footprintRect } = planFloor({
      width: fp.width, depth: fp.depth, floorIndex: f,
      bedrooms: bedroomsPerFloor[f - 1], bathrooms: bathroomsPerFloor[f - 1],
      features, hasStair, isMainBedroomFloor: f === mainBedroomFloorIndex,
    });

    const walls = wallsFromRooms(rooms, footprintRect, f, elevation, floorHeight);
    if (f === 1 && features.garage && rooms.garage) {
      walls.push(...buildGarageWalls(rooms.garage.rect, footprintRect, f, elevation, floorHeight));
    }
    addWindowsAndDoors(walls, rooms, f, f === 1);

    const roomObjs = Object.values(rooms).map((r) => createRoom({
      name: r.name, type: r.type, floor: f, polygon: rectPolygon(r.rect), ceilingHeight: floorHeight - 0.05,
    }));

    levels.push(createLevel({
      index: f, elevation, height: floorHeight,
      footprint: rectPolygon(footprintRect),
      walls, rooms: roomObjs,
    }));

    prevFootprint = fp;
    elevation += floorHeight;
  }

  const stairs = [];
  if (floors > 1) {
    const stairRoom = levels[0].rooms.find((r) => r.type === 'corridor');
    const pos = stairRoom ? [stairRoom.polygon[0][0] + 0.3, stairRoom.polygon[0][1] + 0.3] : [0, 0];
    for (let f = 1; f < floors; f++) {
      stairs.push(createStair({ fromFloor: f, toFloor: f + 1, type: 'l-shaped', position: pos, width: 1.0 }));
    }
  }

  const building = createBuilding({
    name: brief.name || `${bedrooms}-Bedroom ${floors === 1 ? 'Bungalow' : floors === 2 ? 'Duplex' : `${floors}-Storey House`}`,
    levels,
    stairs,
    roof: createRoof({ type: roofType, pitchDeg: style === 'modern' ? 15 : 26, overhang: 0.5 }),
    exterior: {
      compoundWall: !!features.compoundWall,
      gate: !!features.gate,
      porch: !!features.porch,
      garage: features.garage || null,
    },
    metadata: { bedrooms, bathrooms, floors, style, roofType, generatedFrom: 'designBrief' },
  });

  return building;
}
