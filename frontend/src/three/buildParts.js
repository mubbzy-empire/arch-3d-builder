import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';

export const MATERIAL_COLORS = { wood: 0xb98a55, metal: 0xaab2bd, glass: 0x8fd0e0, fabric: 0x6f6a63 };
export const GROUP_LABELS = { structure: 'Walls', roof: 'Roof', door: 'Door', window: 'Windows', interior: 'Interior', 'interior-door': 'Interior door', balcony: 'Balcony', object: 'Object' };

// ---------------------------------------------------------------------------
// Cheap procedural textures — generated once on a <canvas> and cached at
// module scope, reused across every mesh/mount instead of regenerating.
// ---------------------------------------------------------------------------
let woodTextureCache = null;
export function getWoodTexture() {
  if (woodTextureCache) return woodTextureCache;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#bd905e';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const y = Math.random() * size;
    const shade = 0.85 + Math.random() * 0.3;
    ctx.strokeStyle = `rgba(${Math.round(120 * shade)}, ${Math.round(80 * shade)}, ${Math.round(45 * shade)}, ${0.15 + Math.random() * 0.2})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.3, y + (Math.random() - 0.5) * 8, size * 0.7, y + (Math.random() - 0.5) * 8, size, y);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  woodTextureCache = texture;
  return texture;
}

let fabricTextureCache = null;
export function getFabricTexture() {
  if (fabricTextureCache) return fabricTextureCache;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#6f6a63';
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      if ((x + y) % 4 === 0) { ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(x, y, 2, 2); }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.colorSpace = THREE.SRGBColorSpace;
  fabricTextureCache = texture;
  return texture;
}

let shadowTextureCache = null;
export function getShadowTexture() {
  if (shadowTextureCache) return shadowTextureCache;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(0.7, 'rgba(0,0,0,0.22)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  shadowTextureCache = new THREE.CanvasTexture(canvas);
  return shadowTextureCache;
}

export function makeMaterial(materialName, colorHex) {
  const isGlass = materialName === 'glass';
  const isMetal = materialName === 'metal';
  const baseColor = colorHex
    ? new THREE.Color(colorHex)
    : new THREE.Color(materialName === 'wood' || materialName === 'fabric' ? 0xffffff : (MATERIAL_COLORS[materialName] ?? 0xc9a26a));
  const props = {
    color: baseColor,
    roughness: isGlass ? 0.05 : isMetal ? 0.35 : 0.7,
    metalness: isMetal ? 0.75 : isGlass ? 0.15 : 0.04,
    transparent: isGlass,
    opacity: isGlass ? 0.5 : 1,
    envMapIntensity: isGlass ? 1.4 : isMetal ? 1.1 : 0.6,
  };
  if (materialName === 'wood' && !colorHex) props.map = getWoodTexture();
  if (materialName === 'fabric' && !colorHex) props.map = getFabricTexture();
  return new THREE.MeshStandardMaterial(props);
}

export function buildMesh(part) {
  let geometry;
  if (part.type === 'cylinder') {
    geometry = new THREE.CylinderGeometry(part.radiusTop ?? 0.1, part.radiusBottom ?? 0.1, part.height ?? 1, 24);
  } else {
    const [w, h, d] = part.size || [0.5, 0.5, 0.5];
    geometry = new THREE.BoxGeometry(w, h, d);
  }
  const isGlass = part.material === 'glass';
  const mesh = new THREE.Mesh(geometry, makeMaterial(part.material, part.color));
  const [x, y, z] = part.position || [0, 0, 0];
  mesh.position.set(x, y, z);
  mesh.rotation.y = part.rotation || 0;
  mesh.castShadow = !isGlass;
  mesh.receiveShadow = true;
  mesh.userData.group = part.group || 'structure';
  mesh.userData.room = part.room || null;
  mesh.userData.material = part.material || null;
  mesh.userData.originalPosition = mesh.position.clone();
  mesh.userData.originalRotationY = mesh.rotation.y;
  return mesh;
}

// ---------------------------------------------------------------------------
// Small standalone decoration mesh — used for window frames/mullions/sills,
// door frames/handles, balcony rails, and floor-line trim bands. Always a
// flat Mesh (never a Group) so it behaves exactly like every other part in
// the viewer's flat mesh list: individually selectable, disposable, and
// affected by the wireframe/recolor controls.
// ---------------------------------------------------------------------------
function makeTrimMesh({ geometry, x, y, z, rotY = 0, material = 'metal', color, group = 'structure', room = null, castShadow = true }) {
  const mesh = new THREE.Mesh(geometry, makeMaterial(material, color));
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.userData.group = group;
  mesh.userData.room = room;
  mesh.userData.material = material;
  mesh.userData.originalPosition = mesh.position.clone();
  mesh.userData.originalRotationY = mesh.rotation.y;
  return mesh;
}

// Builds the extra dressing meshes (frame + mullions + sill, or frame +
// threshold + handle) that turn a bare glazed/panelled opening into
// something that reads as an architectural window or door instead of a
// flat colored rectangle. `dims` is [width, height, thickness] in the
// opening's own local frame (local +X = width axis, local +Z = thickness /
// outward-facing axis), and `rotY` is the rotation that carries that local
// frame onto the actual wall — this is the same convention used for a
// manually-drawn wall's own rotation, so one function serves both the
// AI/blueprint envelope path and the hand-drawn wall path.
function buildOpeningDetail({ group, dims, position, rotY = 0, material, color, room }) {
  const [ow, oh, od] = dims;
  const [cx, cy, cz] = position;
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  const toWorld = (lx, lz) => [cx + lx * cos + lz * sin, cz - lx * sin + lz * cos];
  const isDoor = group === 'door';
  const frameT = Math.max(0.045, Math.min(ow, oh) * 0.06);
  const frameColor = isDoor ? '#5a3d24' : '#eee7d8';
  const frameMat = isDoor ? 'wood' : 'metal';
  const frameD = Math.max(od * 1.3, 0.03);
  const faceOut = od * 0.55 + 0.006;

  const meshes = [];
  const push = (lx, y, lz, sx, sy, sz, mat, col, cast = true) => {
    const [wx, wz] = toWorld(lx, lz);
    meshes.push(makeTrimMesh({ geometry: new THREE.BoxGeometry(sx, sy, sz), x: wx, y, z: wz, rotY, material: mat, color: col, group, room, castShadow: cast }));
  };
  const pushSphere = (lx, y, lz, r, mat, col) => {
    const [wx, wz] = toWorld(lx, lz);
    meshes.push(makeTrimMesh({ geometry: new THREE.SphereGeometry(r, 8, 8), x: wx, y, z: wz, rotY, material: mat, color: col, group, room, castShadow: false }));
  };

  // Top lintel (and, for windows, a matching bottom rail).
  push(0, cy + oh / 2 - frameT / 2, faceOut, ow + frameT * 0.6, frameT, frameD, frameMat, frameColor);
  if (!isDoor) push(0, cy - oh / 2 + frameT / 2, faceOut, ow + frameT * 0.6, frameT, frameD, frameMat, frameColor);
  // Side jambs.
  const jambY = isDoor ? cy + frameT / 2 : cy;
  const jambH = oh + (isDoor ? frameT : 0);
  push(-ow / 2 + frameT / 2, jambY, faceOut, frameT, jambH, frameD, frameMat, frameColor);
  push(ow / 2 - frameT / 2, jambY, faceOut, frameT, jambH, frameD, frameMat, frameColor);

  if (!isDoor) {
    const mullionT = frameT * 0.55;
    push(0, cy, 0, mullionT, oh - frameT * 2, od * 0.7, frameMat, frameColor, false);
    push(0, cy, 0, ow - frameT * 2, mullionT, od * 0.7, frameMat, frameColor, false);
    // Sill: a small ledge projecting outward below the glazing.
    push(0, cy - oh / 2 - 0.03, od * 1.6, ow + frameT * 1.6, 0.05, od * 4, 'metal', '#cfc9ba');
  } else {
    // Threshold at the foot, and a door handle.
    push(0, cy - oh / 2 + 0.015, od * 2, ow + frameT * 1.4, 0.03, od * 5, 'metal', '#8b8f96');
    pushSphere(ow * 0.34, cy, faceOut + 0.02, 0.02, 'metal', '#d8d4c8');
  }
  return meshes;
}

// ---------------------------------------------------------------------------
// Balcony: a projecting slab at floor level with a railing (top rail, two
// corner posts, and evenly spaced balusters) rather than a bare box. Part
// convention: size = [width, (unused), depth], position = the slab's top
// surface at the wall face, rotation = which way it faces (0 = +Z, radians)
// — the same rotation convention used elsewhere for oriented parts.
// ---------------------------------------------------------------------------
export function buildBalconyMeshes(part) {
  const [width, , depth] = part.size || [1.8, 0.1, 1.0];
  const rot = part.rotation || 0;
  const [cx, cy, cz] = part.position || [0, 1, 0];
  const room = part.room || null;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const toWorld = (lx, lz) => [cx + lx * cos + lz * sin, cz - lx * sin + lz * cos];
  const meshes = [];
  const slabT = 0.1;
  const railH = 0.95;
  const railColor = '#7d838c';

  const [sx, sz] = toWorld(0, depth / 2);
  meshes.push(makeTrimMesh({ geometry: new THREE.BoxGeometry(width, slabT, depth), x: sx, y: cy - slabT / 2, z: sz, rotY: rot, material: part.material || 'wood', color: part.color || '#c9b28a', group: 'balcony', room }));

  const [rx, rz] = toWorld(0, depth - 0.02);
  meshes.push(makeTrimMesh({ geometry: new THREE.BoxGeometry(width, 0.05, 0.05), x: rx, y: cy + railH, z: rz, rotY: rot, material: 'metal', color: railColor, group: 'balcony', room, castShadow: false }));

  const count = Math.max(3, Math.round(width / 0.24));
  for (let i = 0; i <= count; i++) {
    const lx = -width / 2 + (width * i) / count;
    const [bx, bz] = toWorld(lx, depth - 0.02);
    meshes.push(makeTrimMesh({ geometry: new THREE.BoxGeometry(0.03, railH, 0.03), x: bx, y: cy + railH / 2, z: bz, rotY: rot, material: 'metal', color: railColor, group: 'balcony', room, castShadow: false }));
  }
  // Side posts closing the railing back to the wall.
  [-width / 2, width / 2].forEach(lx => {
    const [px, pz] = toWorld(lx, depth * 0.5);
    meshes.push(makeTrimMesh({ geometry: new THREE.BoxGeometry(0.04, railH, depth), x: px, y: cy + railH / 2, z: pz, rotY: rot, material: 'metal', color: railColor, group: 'balcony', room, castShadow: false }));
  });

  return meshes;
}

// ---------------------------------------------------------------------------
// Building shell: turns a single "structure" envelope box into real hollow
// walls with actual cut-through door/window openings, using CSG boolean
// operations — computed locally in the browser, no external service.
// ---------------------------------------------------------------------------
export function buildHollowShell(structurePart, openingParts) {
  const [w, h, d] = structurePart.size || [4, 3, 4];
  const thickness = Math.min(0.25, Math.max(0.06, Math.min(w, d) * 0.02));
  const cornerRadius = Math.min(0.12, Math.min(w, d) * 0.015);

  const outer = new Brush(new RoundedBoxGeometry(w, h, d, 2, cornerRadius));
  outer.updateMatrixWorld();
  const inner = new Brush(new THREE.BoxGeometry(Math.max(w - thickness * 2, 0.05), h + 1, Math.max(d - thickness * 2, 0.05)));
  inner.updateMatrixWorld();

  const evaluator = new Evaluator();
  let shellBrush = evaluator.evaluate(outer, inner, SUBTRACTION);

  const fillMeshes = [];
  for (const part of openingParts) {
    const [ow, oh, od] = part.size || [0.9, 1.2, 0.05];
    const dims = [ow, oh, od];
    const thinIdx = dims.indexOf(Math.min(...dims));
    const cutDims = [...dims];
    cutDims[thinIdx] = thickness * 4;

    const cutter = new Brush(new THREE.BoxGeometry(cutDims[0], cutDims[1], cutDims[2]));
    const [x, y, z] = part.position || [0, 0, 0];
    cutter.position.set(x, y, z);
    cutter.updateMatrixWorld();
    shellBrush = evaluator.evaluate(shellBrush, cutter, SUBTRACTION);

    const fillDims = [...dims];
    fillDims[thinIdx] = thickness * 0.9;
    const isDoor = part.group === 'door';
    const fillGeo = isDoor
      ? new RoundedBoxGeometry(fillDims[0], fillDims[1], fillDims[2], 1, Math.min(0.02, fillDims[0] * 0.05))
      : new THREE.BoxGeometry(fillDims[0], fillDims[1], fillDims[2]);
    const fillMesh = new THREE.Mesh(fillGeo, makeMaterial(part.material || (isDoor ? 'wood' : 'glass'), part.color));
    fillMesh.position.set(x, y, z);
    fillMesh.castShadow = isDoor;
    fillMesh.receiveShadow = true;
    fillMesh.userData.group = part.group || 'window';
    fillMesh.userData.room = part.room || null;
    fillMesh.userData.material = part.material || (isDoor ? 'wood' : 'glass');
    fillMesh.userData.originalPosition = fillMesh.position.clone();
    fillMesh.userData.originalRotationY = fillMesh.rotation.y;
    fillMeshes.push(fillMesh);

    // Frame, mullions/sill (windows) or frame/threshold/handle (doors) —
    // reorient the opening's own dims into the [width, height, thickness]
    // local frame buildOpeningDetail expects, and pick the rotY that carries
    // that local frame onto whichever face of the building this opening is
    // actually on (still world-axis-aligned here since the envelope itself
    // is never rotated, but +Z/-Z and +X/-X faces need opposite rotations).
    let detailDims = dims;
    let detailRotY = 0;
    if (thinIdx === 2) {
      detailRotY = z >= 0 ? 0 : Math.PI;
    } else if (thinIdx === 0) {
      detailDims = [od, oh, ow];
      detailRotY = x >= 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      detailDims = null; // skylight-style opening (rare) — skip detailing
    }
    if (detailDims) {
      const detailMeshes = buildOpeningDetail({
        group: part.group || 'window', dims: detailDims, position: [x, y, z], rotY: detailRotY,
        material: part.material, color: part.color, room: part.room || null,
      });
      fillMeshes.push(...detailMeshes);
    }
  }

  shellBrush.material = makeMaterial(structurePart.material || 'wood', structurePart.color);
  shellBrush.castShadow = true;
  shellBrush.receiveShadow = true;
  shellBrush.userData.group = 'structure';
  shellBrush.userData.room = null;
  shellBrush.userData.material = structurePart.material || 'wood';
  shellBrush.userData.originalPosition = shellBrush.position.clone();
  shellBrush.userData.originalRotationY = shellBrush.rotation.y;

  return { shellMesh: shellBrush, fillMeshes };
}

// ---------------------------------------------------------------------------
// Manual modeler support: a wall drawn point-to-point (with its own
// position/rotation, not part of one whole-building envelope) gets its
// door/window openings cut directly out of that single wall segment —
// simpler than buildHollowShell (no outer/inner hollowing step, since a
// hand-drawn wall is already a thin solid slab) but still real CSG, so a
// door in a manually-drawn wall is an actual hole, not a decal.
// ---------------------------------------------------------------------------
export function buildWallWithOpenings(wallPart, openingParts) {
  const [w, h, d] = wallPart.size || [2, 3, 0.15];
  const rotY = wallPart.rotation || 0;
  const [wx, wy, wz] = wallPart.position || [0, h / 2, 0];

  const wallBrush = new Brush(new THREE.BoxGeometry(w, h, d));
  wallBrush.position.set(wx, wy, wz);
  wallBrush.rotation.y = rotY;
  wallBrush.updateMatrixWorld();

  if (!openingParts.length) {
    const solid = new THREE.Mesh(wallBrush.geometry, makeMaterial(wallPart.material || 'wood', wallPart.color));
    solid.position.copy(wallBrush.position);
    solid.rotation.y = rotY;
    solid.castShadow = true;
    solid.receiveShadow = true;
    solid.userData.group = 'structure';
    solid.userData.room = null;
    solid.userData.material = wallPart.material || 'wood';
    solid.userData.originalPosition = solid.position.clone();
    solid.userData.originalRotationY = solid.rotation.y;
    return { wallMesh: solid, fillMeshes: [] };
  }

  const evaluator = new Evaluator();
  let shellBrush = wallBrush;
  const fillMeshes = [];

  for (const part of openingParts) {
    const [ow, oh, od] = part.size || [0.9, 1.2, 0.2];
    const [ox, oy, oz] = part.position || [wx, oh / 2, wz];
    const isDoor = part.group === 'door';

    const cutter = new Brush(new THREE.BoxGeometry(ow, oh, Math.max(od, d * 3)));
    cutter.position.set(ox, oy, oz);
    cutter.rotation.y = rotY;
    cutter.updateMatrixWorld();
    shellBrush = evaluator.evaluate(shellBrush, cutter, SUBTRACTION);

    const fillMesh = new THREE.Mesh(
      new THREE.BoxGeometry(ow * 0.94, oh, Math.max(d * 0.85, 0.04)),
      makeMaterial(part.material || (isDoor ? 'wood' : 'glass'), part.color)
    );
    fillMesh.position.set(ox, oy, oz);
    fillMesh.rotation.y = rotY;
    fillMesh.castShadow = isDoor;
    fillMesh.receiveShadow = true;
    fillMesh.userData.group = part.group;
    fillMesh.userData.room = part.room || null;
    fillMesh.userData.material = part.material || (isDoor ? 'wood' : 'glass');
    fillMesh.userData.originalPosition = fillMesh.position.clone();
    fillMesh.userData.originalRotationY = fillMesh.rotation.y;
    fillMeshes.push(fillMesh);

    const detailMeshes = buildOpeningDetail({
      group: part.group, dims: [ow, oh, Math.max(od, 0.06)], position: [ox, oy, oz], rotY,
      material: part.material, color: part.color, room: part.room || null,
    });
    fillMeshes.push(...detailMeshes);
  }

  shellBrush.material = makeMaterial(wallPart.material || 'wood', wallPart.color);
  shellBrush.castShadow = true;
  shellBrush.receiveShadow = true;
  shellBrush.userData.group = 'structure';
  shellBrush.userData.room = null;
  shellBrush.userData.material = wallPart.material || 'wood';
  shellBrush.userData.originalPosition = shellBrush.position.clone();
  shellBrush.userData.originalRotationY = shellBrush.rotation.y;

  return { wallMesh: shellBrush, fillMeshes };
}

// Builds the full mesh list for the manual modeler's flat parts array.
// Each part may be: a wall (group 'structure', has its own id), an opening
// attached to a wall (group 'door'/'window', carries wallId referencing the
// wall's part id), or a freestanding primitive (box/cylinder/floor/furniture
// with no wallId). Openings are grouped by wallId and cut into their own
// wall only — never the whole scene — so editing one wall never touches
// another's geometry.
export function buildManualMeshes(parts) {
  const walls = parts.filter(p => p.group === 'structure');
  const openings = parts.filter(p => p.group === 'door' || p.group === 'window');
  const freestanding = parts.filter(p => p.group !== 'structure' && p.group !== 'door' && p.group !== 'window');

  const meshes = [];
  const idToMeshes = {};

  walls.forEach(wall => {
    const wallOpenings = openings.filter(o => o.wallId === wall.id);
    const { wallMesh, fillMeshes } = buildWallWithOpenings(wall, wallOpenings);
    wallMesh.userData.partId = wall.id;
    wallMesh.userData.floor = wall.floor ?? 1;
    meshes.push(wallMesh);
    idToMeshes[wall.id] = [wallMesh];
    wallOpenings.forEach((o, i) => {
      const fm = fillMeshes[i];
      if (!fm) return;
      fm.userData.partId = o.id;
      fm.userData.floor = wall.floor ?? 1;
      meshes.push(fm);
      idToMeshes[o.id] = [fm];
    });
  });

  freestanding.forEach(p => {
    const m = buildMesh(p);
    m.userData.partId = p.id;
    m.userData.floor = p.floor ?? 1;
    meshes.push(m);
    idToMeshes[p.id] = [m];
  });

  return { meshes, idToMeshes };
}

// ---------------------------------------------------------------------------
// Interior connecting doors: a partition wall (group "interior") that
// physically divides two rooms is otherwise a solid slab — nothing lets a
// person actually pass from one demarcated room into the next. An
// "interior-door" part is matched to whichever partition wall it geometrically
// sits against (same floor, close to the wall's face, within its run) and
// gets a real CSG cutout + frame/threshold, exactly like an exterior door,
// so rooms are genuinely connected rather than just visually separated.
// ---------------------------------------------------------------------------
function isPartitionWall(p) {
  const [w, h, d] = p.size || [0, 0, 0];
  return h > 1.2 && Math.max(w, d) > 0.5 && Math.min(w, d) < 0.3;
}

function doorMatchesWall(doorPart, wallPart) {
  if ((doorPart.floor ?? 1) !== (wallPart.floor ?? 1)) return false;
  const [ww, , wd] = wallPart.size || [0.1, 3, 0.1];
  const [wx, , wz] = wallPart.position || [0, 0, 0];
  const [dx, , dz] = doorPart.position || [0, 0, 0];
  const thinIsX = ww < wd;
  return thinIsX
    ? Math.abs(dx - wx) < ww / 2 + 0.35 && Math.abs(dz - wz) <= wd / 2 + 0.05
    : Math.abs(dz - wz) < wd / 2 + 0.35 && Math.abs(dx - wx) <= ww / 2 + 0.05;
}

// Cuts every interior door matched to this wall out of it. `buildWallWithOpenings`
// assumes its wall's thickness runs along local Z (rotation 0); a partition
// wall authored thin-along-X instead is passed through with an effective 90°
// rotation and a reordered size so the same CSG/frame code applies unchanged.
function buildInteriorWallWithDoors(wallPart, doorParts) {
  const [ww, wh, wd] = wallPart.size || [0.1, 3, 4];
  const thinIsX = ww < wd;
  const canonicalWall = thinIsX
    ? { ...wallPart, size: [wd, wh, ww], rotation: Math.PI / 2 }
    : { ...wallPart, size: [ww, wh, wd], rotation: 0 };
  const { wallMesh, fillMeshes } = buildWallWithOpenings(canonicalWall, doorParts.map(d => ({ ...d, group: 'door' })));
  wallMesh.userData.room = wallPart.room || null;
  return { wallMesh, fillMeshes };
}

// Builds one building's full mesh list (walls w/ real cutouts, floors,
// roof, balconies) from its modelSpec.parts — shared by the single-building
// editor and the multi-building estate viewer so both produce identical
// geometry quality.
export function buildBuildingMeshes(parts) {
  const openingParts = parts.filter(p => p.group === 'door' || p.group === 'window');
  const structureParts = parts.filter(p => p.group === 'structure' || !p.group);
  const interiorDoorParts = parts.filter(p => p.group === 'interior-door');
  const otherParts = parts.filter(p => p.group && p.group !== 'structure' && p.group !== 'door' && p.group !== 'window' && p.group !== 'interior-door');
  const partitionWalls = otherParts.filter(p => p.group === 'interior' && isPartitionWall(p));
  const nonPartitionOther = otherParts.filter(p => !(p.group === 'interior' && isPartitionWall(p)));

  const meshes = [];
  const floorNumbers = [...new Set(structureParts.map(p => p.floor ?? 1))].sort((a, b) => a - b);
  const isBuilding = openingParts.length > 0 && structureParts.length > 0;

  if (isBuilding) {
    floorNumbers.forEach((floorNum, idx) => {
      const floorStructure = structureParts.filter(p => (p.floor ?? 1) === floorNum);
      const floorOpenings = openingParts.filter(p => (p.floor ?? 1) === floorNum);
      const [envelope, ...extraStructure] = floorStructure;
      if (!envelope) return;
      const { shellMesh, fillMeshes } = buildHollowShell(envelope, floorOpenings);
      shellMesh.userData.floor = floorNum;
      fillMeshes.forEach(m => { m.userData.floor = floorNum; });
      meshes.push(shellMesh, ...fillMeshes);
      extraStructure.forEach(p => {
        const m = buildMesh(p);
        m.userData.floor = floorNum;
        meshes.push(m);
      });

      // Decorative string-course band at every floor line above the
      // ground floor, and a plinth at the very base — small, cheap details
      // that keep a multi-story stack from reading as identical boxes
      // glued together, and give every extra floor a clear visual seam.
      const [ew, eh, ed] = envelope.size || [4, 3, 4];
      const [ecx, ecy, ecz] = envelope.position || [0, eh / 2, 0];
      const baseY = ecy - eh / 2;
      const overhang = Math.min(0.07, Math.min(ew, ed) * 0.012) + 0.025;
      if (idx > 0) {
        meshes.push(makeTrimMesh({
          geometry: new THREE.BoxGeometry(ew + overhang * 2, 0.11, ed + overhang * 2),
          x: ecx, y: baseY + 0.05, z: ecz, material: 'metal', color: '#d8d2c1', group: 'structure', castShadow: true,
        }));
      } else {
        meshes.push(makeTrimMesh({
          geometry: new THREE.BoxGeometry(ew + overhang * 2, 0.22, ed + overhang * 2),
          x: ecx, y: baseY - 0.06, z: ecz, material: 'metal', color: '#4b4e53', group: 'structure', castShadow: true,
        }));
      }
    });
  } else {
    structureParts.forEach(p => {
      const m = buildMesh(p);
      m.userData.floor = p.floor ?? 1;
      meshes.push(m);
    });
  }
  // Partition walls: any matched interior-door gets a real cutout + frame;
  // walls with no matching door stay solid. Balconies get their railing
  // built out; everything else (floor slabs, freestanding primitives) is
  // a plain mesh — same as before, just no longer double-building
  // partition walls that now go through the door-matching path above.
  const usedDoorIds = new Set();
  partitionWalls.forEach(wall => {
    const myDoors = interiorDoorParts.filter((d, i) => !usedDoorIds.has(i) && doorMatchesWall(d, wall));
    if (myDoors.length) {
      interiorDoorParts.forEach((d, i) => { if (myDoors.includes(d)) usedDoorIds.add(i); });
      const { wallMesh, fillMeshes } = buildInteriorWallWithDoors(wall, myDoors);
      wallMesh.userData.floor = wall.floor ?? 1;
      fillMeshes.forEach(m => { m.userData.floor = wall.floor ?? 1; });
      meshes.push(wallMesh, ...fillMeshes);
    } else {
      const m = buildMesh(wall);
      m.userData.floor = wall.floor ?? 1;
      m.userData.room = wall.room || null;
      meshes.push(m);
    }
  });
  nonPartitionOther.forEach(p => {
    if (p.group === 'balcony') {
      const bMeshes = buildBalconyMeshes(p);
      bMeshes.forEach(m => { m.userData.floor = p.floor ?? 1; });
      meshes.push(...bMeshes);
      return;
    }
    const m = buildMesh(p);
    m.userData.floor = p.floor ?? 1;
    m.userData.room = p.room || null;
    meshes.push(m);
  });

  return meshes;
}
