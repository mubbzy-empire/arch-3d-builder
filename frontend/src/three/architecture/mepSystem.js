// ---------------------------------------------------------------------------
// mepSystem.js
//
// The visible MEP (electrical + plumbing) layer — a toggleable overlay
// (userData.group === 'mep' on every mesh/line in it, off by default,
// switched on the same way "Show interior" already switches the roof) that
// gives real, room-derived form to estimateMEPRequirements()'s numbers
// instead of leaving them as text in a panel.
//
// Every position here comes from mepLayout.js's pure functions, which are
// unit-tested on their own (see that file's test coverage) — this file's
// only job is turning verified [x,z]/[x,y,z] points into real geometry.
//
// Scope, stated the same way mepLayout.js states it: this is a schematic
// M&E layer (real device counts, real approximate positions, real AFFL
// heights, routed from the actual DB/riser location) — not a full circuit-
// routing/cavity-clash-checked MEP design. See mepLayout.js's header.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { estimateMEPRequirements } from './constructionAssemblies.js';
import {
  OUTLET_HEIGHT, SWITCH_HEIGHT,
  roomCentroid, pointOnWallInset, spreadPointsOnPolygon, conduitRunPoints,
} from './mepLayout.js';

const DEVICE_MAT = new THREE.MeshStandardMaterial({ color: '#e8e4da', roughness: 0.5 });
const DB_MAT = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.4, metalness: 0.3 });
const LIGHT_MAT = new THREE.MeshStandardMaterial({ color: '#fce8a8', emissive: '#7a6428', emissiveIntensity: 0.4, roughness: 0.6 });
const CONDUIT_COLOR = '#3a6fa8';
const SUPPLY_COLOR = '#6ba0c9';
const SOIL_COLOR = '#4a4f57';

// Every MEP leaf defaults to invisible here, at the single point they're
// all tagged — not left to whichever viewer happens to wire up a toggle.
// ModelViewer.jsx has a "Show MEP" effect that explicitly sets `.visible`
// on mount and on toggle, so this default is redundant-but-harmless there.
// SceneViewer.jsx (the estate view) has no per-layer toggle at all — only
// whole-building show/hide — and estate buildings run through the same
// buildBuildingGroup() that now always includes MEP geometry. Without this
// default, every conduit line and pipe in every estate building would be
// permanently visible clutter with no way to turn it off, since nothing
// else in that view ever sets `.visible` on a mep-tagged object. Building
// a full per-building MEP toggle for the estate view is real future work,
// not done here — but "MEP defaults to off" has to hold everywhere the
// geometry can end up, not just in the one viewer that got a button.
function tag(obj, fields) {
  obj.userData.group = 'mep';
  obj.visible = false;
  Object.assign(obj.userData, fields);
  return obj;
}

function deviceBox(w, h, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  return mesh;
}

function conduitLine(points, color = CONDUIT_COLOR) {
  const geo = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const mat = new THREE.LineDashedMaterial({ color, dashSize: 0.08, gapSize: 0.05 });
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances(); // required for a dashed material to actually render dashed
  return line;
}

// A straight pipe between two world points. Built via Quaternion
// setFromUnitVectors (aligning CylinderGeometry's default +Y axis onto the
// pipe's real direction) rather than hand-derived Euler angles — the exact
// lesson learned, and independently verified, while building the stair
// soffit in Phase 2. In this file every actual call is a vertical riser
// (dir already parallel to +Y), so the quaternion is trivially near-
// identity, but the general-case-safe approach is used anyway so this
// function is correct if a future caller ever routes a non-vertical run.
function pipe(a, b, radius, color) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const dir = new THREE.Vector3().subVectors(end, start);
  const len = dir.length();
  if (len < 1e-6) return new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, len, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.2 }),
  );
  mesh.position.copy(start).addScaledVector(dir, 0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  mesh.setRotationFromQuaternion(quat);
  return mesh;
}

export function buildElectricalGroup(building) {
  const group = new THREE.Group();
  group.name = 'mep_electrical';

  const groundLevel = building.levels[0];
  if (!groundLevel) return group;

  const mep = estimateMEPRequirements(building);

  // Distribution board — mounted on the first exterior wall found on the
  // ground floor, standard 1.5m AFFL. Everything else routes from here.
  const dbWall = groundLevel.walls.find((w) => w.type === 'exterior') || groundLevel.walls[0];
  let dbPos = [0, groundLevel.elevation + 1.5, 0];
  if (dbWall) {
    const [dx, dz] = pointOnWallInset(dbWall, 0.15, 0.05);
    dbPos = [dx, groundLevel.elevation + 1.5, dz];
  }
  const db = deviceBox(0.35, 0.45, 0.12, DB_MAT);
  db.position.set(...dbPos);
  tag(db, { material: 'distribution board', mepType: 'electrical-db', floor: groundLevel.index });
  group.add(db);

  for (const level of building.levels) {
    for (const room of level.rooms) {
      // A room with no polygon (or a degenerate 1-2 point one) has no real
      // geometry to derive a light/socket layout from — roomCentroid and
      // spreadPointsOnPolygon are both safe against this (won't throw),
      // but silently placing a light fixture and a conduit run at [0,0]
      // for it would draw a stray fitting at the building's origin, which
      // is a worse outcome than just skipping a room the data doesn't
      // actually describe yet.
      if (!room.polygon || room.polygon.length < 3) continue;
      const roomLabel = room.name || room.type;
      const rule = mep.electrical.perRoom.find((r) => r.room === roomLabel && r.floor === level.index);
      const socketCount = rule ? rule.sockets : 2;
      const ceilH = room.ceilingHeight || level.height - 0.05;
      const ceilY = level.elevation + ceilH;
      const [cx, cz] = roomCentroid(room);

      // Ceiling light point at the room centroid — CircleGeometry lying
      // flat, the same rotateX(PI/2) floorSystem.js already uses for
      // ceiling planes, so there's no new rotation convention introduced.
      const light = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), LIGHT_MAT);
      light.rotateX(Math.PI / 2);
      light.position.set(cx, ceilY - 0.02, cz);
      tag(light, { material: 'ceiling light fitting', room: roomLabel, floor: level.index });
      group.add(light);
      const lightRun = conduitLine(conduitRunPoints(dbPos, ceilY, [cx, cz], ceilY));
      tag(lightRun, { material: 'lighting conduit', room: roomLabel, floor: level.index });
      group.add(lightRun);

      // Sockets spread evenly around the room's real perimeter (see
      // mepLayout.js — arc-length spacing, not naive edge-cycling).
      const socketPoints = spreadPointsOnPolygon(room.polygon, socketCount);
      socketPoints.forEach(([px, pz]) => {
        const outlet = deviceBox(0.09, 0.09, 0.02, DEVICE_MAT);
        outlet.position.set(px, level.elevation + OUTLET_HEIGHT, pz);
        tag(outlet, { material: 'socket outlet', room: roomLabel, floor: level.index });
        group.add(outlet);
        const run = conduitLine(conduitRunPoints(dbPos, ceilY, [px, pz], level.elevation + OUTLET_HEIGHT));
        tag(run, { material: 'power conduit', room: roomLabel, floor: level.index });
        group.add(run);
      });

      // One light switch per room, near the first polygon edge.
      const [swX, swZ] = spreadPointsOnPolygon(room.polygon, 1)[0] || [cx, cz];
      const sw = deviceBox(0.08, 0.08, 0.02, DEVICE_MAT);
      sw.position.set(swX, level.elevation + SWITCH_HEIGHT, swZ);
      tag(sw, { material: 'light switch', room: roomLabel, floor: level.index });
      group.add(sw);
    }
  }
  return group;
}

export function buildPlumbingGroup(building) {
  const group = new THREE.Group();
  group.name = 'mep_plumbing';

  const mep = estimateMEPRequirements(building);
  if (!mep.plumbing.perRoom.length) return group; // no wet rooms — nothing to route

  const groundLevel = building.levels[0];
  const top = building.levels[building.levels.length - 1];
  if (!groundLevel || !top) return group;

  // Supply riser + soil/vent stack, positioned at the first wet room found
  // (ground floor if there is one there) that actually has a real polygon
  // to derive a position from — running the full building height, matching
  // the vertical-riser note estimateMEPRequirements() already gives for
  // multi-storey buildings. Searches past any wet room entry that lacks
  // usable geometry rather than taking perRoom[0] unconditionally and
  // risking the entire riser landing at the world origin because the
  // first wet room in the list happens to be missing its polygon.
  let riserRoom = null;
  for (const wet of mep.plumbing.perRoom) {
    const lvl = building.levels.find((l) => l.index === wet.floor);
    if (!lvl) continue;
    const candidate = lvl.rooms.find((r) => (r.name || r.type) === wet.room);
    if (candidate && candidate.polygon && candidate.polygon.length >= 3) {
      riserRoom = candidate;
      break;
    }
  }
  if (!riserRoom) return group; // no wet room with usable geometry — nothing safe to route
  const [rx, rz] = roomCentroid(riserRoom);
  const baseY = groundLevel.elevation;
  const topY = top.elevation + top.height + 0.6; // vent stack terminates above the roofline

  const supply = pipe([rx - 0.15, baseY, rz], [rx - 0.15, topY, rz], 0.02, SUPPLY_COLOR);
  tag(supply, { material: 'copper supply riser', mepType: 'plumbing-riser' });
  group.add(supply);

  const soil = pipe([rx + 0.15, baseY, rz], [rx + 0.15, topY, rz], 0.045, SOIL_COLOR);
  tag(soil, { material: 'PVC soil/vent stack', mepType: 'plumbing-stack' });
  group.add(soil);

  for (const wet of mep.plumbing.perRoom) {
    const level = building.levels.find((l) => l.index === wet.floor);
    if (!level) continue;
    const room = level.rooms.find((r) => (r.name || r.type) === wet.room);
    if (!room || !room.polygon || room.polygon.length < 3) continue;
    const [cx, cz] = roomCentroid(room);
    const branchY = level.elevation + 0.15;
    const branch = conduitLine([[rx, branchY, rz], [cx, branchY, cz]], SUPPLY_COLOR);
    tag(branch, { material: 'branch supply pipe', room: room.name || room.type, floor: level.index });
    group.add(branch);

    const fixture = deviceBox(0.12, 0.12, 0.12, DEVICE_MAT);
    fixture.position.set(cx, level.elevation + 0.1, cz);
    tag(fixture, { material: 'fixture connection point', room: room.name || room.type, floor: level.index });
    group.add(fixture);
  }
  return group;
}

// Public entry point — mirrors buildStairGroup/buildRoofGroup's shape:
// one Group ready to add to the scene, both sub-layers combined and every
// leaf (mesh AND line — see the header note on why this matters) tagged
// userData.group === 'mep' so the viewer's existing per-object visibility
// toggle can find and hide/show all of it, the same way it already does
// for the roof. This Group itself is never given `.visible = false` here
// — parent-level hiding would make every child invisible regardless of
// its own `.visible` flag, defeating the leaf-level toggle the viewer
// uses. "Off by default" is a viewer-side initial-state concern, not a
// geometry-building one; see ModelViewer.jsx/SceneViewer.jsx for that.
export function buildMepGroup(building) {
  const group = new THREE.Group();
  group.name = 'mep';
  group.userData.group = 'mep';
  group.add(buildElectricalGroup(building));
  group.add(buildPlumbingGroup(building));
  return group;
}
