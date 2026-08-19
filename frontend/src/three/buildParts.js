import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';

export const MATERIAL_COLORS = { wood: 0xb98a55, metal: 0xaab2bd, glass: 0x8fd0e0, fabric: 0x6f6a63, concrete: 0xb9b6ad };
export const GROUP_LABELS = { structure: 'Walls', roof: 'Roof', door: 'Door', window: 'Windows', interior: 'Interior', 'interior-door': 'Interior door', balcony: 'Balcony', pool: 'Swimming pool', compound: 'Compound wall', object: 'Object', stair: 'Stair', slab: 'Slab' };

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

// ---------------------------------------------------------------------------
// Painted-siding and shingle-roof textures — tinted per-instance from
// whatever hex color the AI (or the user's swatch picker) chose, cached by
// color so repeat colors across a model/estate reuse one canvas instead of
// redrawing it. This is what turns a flat single-color wall/roof box into
// something that reads as painted board siding and coursed roofing, the way
// a real finished elevation photo does, instead of a solid plastic block.
// ---------------------------------------------------------------------------
const sidingTextureCache = new Map();
export function getSidingTexture(colorHex) {
  const key = colorHex || '#cfc9b8';
  if (sidingTextureCache.has(key)) return sidingTextureCache.get(key);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const base = new THREE.Color(key);
  ctx.fillStyle = `rgb(${Math.round(base.r * 255)},${Math.round(base.g * 255)},${Math.round(base.b * 255)})`;
  ctx.fillRect(0, 0, size, size);
  // Vertical panel seams — the recessed joints between siding/cladding boards.
  const panelW = size / 8;
  for (let x = 0; x <= size; x += panelW) {
    const grad = ctx.createLinearGradient(x - 3, 0, x + 3, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.18)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - 3, 0, 6, size);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x + 2, 0, 1.5, size);
  }
  // Faint horizontal weathering streaks so the paint doesn't look perfectly flat.
  for (let i = 0; i < 26; i++) {
    const y = Math.random() * size;
    ctx.strokeStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.045})`;
    ctx.lineWidth = 0.6 + Math.random();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + (Math.random() - 0.5) * 4);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 1.4);
  texture.colorSpace = THREE.SRGBColorSpace;
  sidingTextureCache.set(key, texture);
  return texture;
}

const roofTextureCache = new Map();
export function getRoofTexture(colorHex) {
  const key = colorHex || '#243447';
  if (roofTextureCache.has(key)) return roofTextureCache.get(key);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const base = new THREE.Color(key);
  ctx.fillStyle = `rgb(${Math.round(base.r * 255)},${Math.round(base.g * 255)},${Math.round(base.b * 255)})`;
  ctx.fillRect(0, 0, size, size);
  // Horizontal shingle/sheet courses.
  const courseH = size / 14;
  for (let y = 0; y <= size; y += courseH) {
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.fillRect(0, y, size, 1.6);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, y + 2, size, 1);
  }
  // Fine speckle so it catches light unevenly like a real roof surface.
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.06})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.2, 2.2);
  texture.colorSpace = THREE.SRGBColorSpace;
  roofTextureCache.set(key, texture);
  return texture;
}

// Exterior wall material — painted board siding, tinted to whatever color
// the design specifies (falls back to a neutral warm white).
export function makeSidingMaterial(colorHex) {
  return new THREE.MeshStandardMaterial({
    map: getSidingTexture(colorHex),
    roughness: 0.82,
    metalness: 0.02,
    envMapIntensity: 0.5,
  });
}

// Roof material — coursed/shingled, tinted to whatever color the design
// specifies (falls back to a dark slate-navy, the most common real roof tone).
export function makeRoofMaterial(colorHex) {
  return new THREE.MeshStandardMaterial({
    map: getRoofTexture(colorHex || '#243447'),
    roughness: 0.5,
    metalness: 0.18,
    envMapIntensity: 0.9,
  });
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

// Zone/room-tag overlay — a flat, semi-transparent colour wash at floor
// level, the way a plan-view "zone" reads in real CAD tools (an area
// diagram, not a physical object). Deliberately its own material rather
// than reusing the 'glass' branch above: glass is meant to look like an
// actual reflective/refractive surface (high env-map intensity, low
// roughness), which would make a room-area tag look like a shiny pane
// sitting on the floor instead of a flat diagram wash.
export function makeZoneMaterial(colorHex) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex || '#7cc4ff'),
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.35,
    depthWrite: false, // avoids z-fighting flicker with the floor slab it sits directly on
  });
}

// Wall-shaped vs slab-shaped interior part — tall and thin reads as a
// partition wall, flat reads as a floor/ceiling slab. Used both to pick
// interior finish (paint vs floor texture) and, further down, to route
// interior-door cutting to the right walls.
function isWallShapedPart(p) {
  const [w, h, d] = p.size || [0, 0, 0];
  return h > 1.2 && Math.max(w, d) > 0.5 && Math.min(w, d) < 0.3;
}

// Interior partition-wall paint — smoother and flatter than the exterior
// siding texture (no panel seams: real interior drywall reads as a soft
// eggshell finish, not board cladding), just enough grain to avoid a
// perfectly flat plastic look under interior lighting.
const paintTextureCache = new Map();
export function getPaintTexture(colorHex) {
  const key = colorHex || '#eef0ea';
  if (paintTextureCache.has(key)) return paintTextureCache.get(key);
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const base = new THREE.Color(key);
  ctx.fillStyle = `rgb(${Math.round(base.r * 255)},${Math.round(base.g * 255)},${Math.round(base.b * 255)})`;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillStyle = `rgba(0,0,0,${0.015 + Math.random() * 0.025})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  paintTextureCache.set(key, texture);
  return texture;
}
export function makeInteriorPaintMaterial(colorHex) {
  return new THREE.MeshStandardMaterial({ map: getPaintTexture(colorHex), roughness: 0.9, metalness: 0.01, envMapIntensity: 0.3 });
}

// Interior floor — plank texture tinted to whatever color the AI/template
// chose for the slab, instead of a single flat fill color.
const floorTextureCache = new Map();
export function getFloorTexture(colorHex) {
  const key = colorHex || '#c9b28a';
  if (floorTextureCache.has(key)) return floorTextureCache.get(key);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const base = new THREE.Color(key);
  ctx.fillStyle = `rgb(${Math.round(base.r * 255)},${Math.round(base.g * 255)},${Math.round(base.b * 255)})`;
  ctx.fillRect(0, 0, size, size);
  const plankH = size / 10;
  for (let y = 0; y <= size; y += plankH) {
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(0, y, size, 1.4);
    // stagger plank end-joints row to row, like a real floated floor
    const offset = (Math.round(y / plankH) % 2) * size * 0.3;
    for (let x = -size; x < size * 2; x += size * 0.6) {
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(x + offset, y + 1.5, 1.2, plankH - 1.5);
    }
  }
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillStyle = `rgba(80,55,25,${0.03 + Math.random() * 0.05})`;
    ctx.fillRect(x, y, 1 + Math.random() * 6, 0.6);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.colorSpace = THREE.SRGBColorSpace;
  floorTextureCache.set(key, texture);
  return texture;
}
export function makeFloorMaterial(colorHex) {
  return new THREE.MeshStandardMaterial({ map: getFloorTexture(colorHex), roughness: 0.55, metalness: 0.02, envMapIntensity: 0.6 });
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
  const material = part.group === 'roof'
    ? makeRoofMaterial(part.color)
    : part.group === 'structure'
      ? makeSidingMaterial(part.color)
      : part.group === 'interior'
        ? (isWallShapedPart(part) ? makeInteriorPaintMaterial(part.color) : makeFloorMaterial(part.color))
        : part.group === 'zone'
          ? makeZoneMaterial(part.color)
          : makeMaterial(part.material, part.color);
  const mesh = new THREE.Mesh(geometry, material);
  const [x, y, z] = part.position || [0, 0, 0];
  mesh.position.set(x, y, z);
  mesh.rotation.y = part.rotation || 0;
  mesh.castShadow = !isGlass && part.group !== 'zone';
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
  // A door opening ~2.2m or wider reads as a vehicle entrance rather than a
  // person door — dress it as a sectional garage door (horizontal panel
  // lines, no handle) instead of a hinged-door frame, so anyone who asks
  // for "a garage" gets one just by sizing a door part wide enough; no new
  // part type needed.
  const isGarage = isDoor && ow >= 2.2;
  const frameT = Math.max(0.045, Math.min(ow, oh) * 0.06);
  const frameColor = isDoor ? '#5a3d24' : '#f4f1e6';
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
  } else if (isGarage) {
    // Sectional garage door: evenly spaced horizontal panel lines across
    // the face instead of a handle, plus a slightly heavier header lintel.
    const sections = Math.max(3, Math.round(oh / 0.55));
    for (let i = 1; i < sections; i++) {
      const ly = cy - oh / 2 + (oh * i) / sections;
      push(0, ly, faceOut * 0.55, ow - frameT * 1.4, 0.03, frameD * 0.5, 'metal', '#c7c7c0', false);
    }
    push(0, cy - oh / 2 + 0.015, od * 2, ow + frameT * 1.4, 0.03, od * 5, 'metal', '#8b8f96');
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
// Swimming pool: a sunken basin with tiled side walls, a coping/deck rim,
// and a water surface — added whenever a spec includes a "pool" group part,
// so anyone who asks for a pool on their model gets real pool geometry
// rather than nothing. Part convention: size = [width, waterDepth, length]
// (waterDepth is how far the basin sinks below ground), position = the
// center of the deck rim at ground level (y is normally 0).
// ---------------------------------------------------------------------------
export function buildPoolMesh(part) {
  const [width, poolDepth, length] = part.size || [4, 1.3, 8];
  const [cx, cy, cz] = part.position || [0, 0, 0];
  const room = part.room || 'Pool';
  const meshes = [];
  const copingT = 0.35;

  // Deck / coping rim, flush with the ground.
  meshes.push(makeTrimMesh({
    geometry: new THREE.BoxGeometry(width + copingT * 2, 0.08, length + copingT * 2),
    x: cx, y: cy - 0.02, z: cz, material: 'metal', color: part.color || '#d8d2c1', group: 'pool', room,
  }));

  // Basin (tiled walls/floor) — a simple solid block is a fine cheap stand-in
  // since the water surface hides everything below its own top face anyway.
  const basinMat = makeMaterial('metal', '#bcd9dd');
  const basin = new THREE.Mesh(new THREE.BoxGeometry(width, poolDepth, length), basinMat);
  basin.position.set(cx, cy - poolDepth / 2, cz);
  basin.receiveShadow = true;
  basin.userData.group = 'pool';
  basin.userData.room = room;
  basin.userData.material = 'metal';
  basin.userData.originalPosition = basin.position.clone();
  basin.userData.originalRotationY = 0;
  meshes.push(basin);

  // Water surface, sitting a little below the coping so the rim reads.
  const waterMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(part.waterColor || '#2fa4c9'),
    roughness: 0.06, metalness: 0.05, transparent: true, opacity: 0.85, envMapIntensity: 1.5,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.1, length - 0.1), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx, cy - 0.12, cz);
  water.receiveShadow = true;
  water.userData.group = 'pool';
  water.userData.room = room;
  water.userData.material = 'glass';
  water.userData.originalPosition = water.position.clone();
  water.userData.originalRotationY = 0;
  meshes.push(water);

  return meshes;
}

// ---------------------------------------------------------------------------
// Real hip roof: four sloped rectangular planes (two trapezoids, two
// triangular hips) meeting a ridge line, sized to a rectangular footprint.
// Replaces the old convention of approximating a "hip roof" with a circular
// cone (radiusTop ~0) sat on a rectangular building — a round cone over a
// rectangular footprint overhangs unevenly at the corners and never actually
// meets the walls cleanly, which is the single biggest reason a generated
// building fails to read as a real house. This builds an exact match to the
// footprint instead, with a flat ridge and consistent eave overhang all the
// way around.
// ---------------------------------------------------------------------------
export function buildHipRoofMesh({ width, depth, ridgeHeight, overhang = 0.4, position, material = 'metal', color, group = 'roof', floor }) {
  const halfW = width / 2 + overhang;
  const halfD = depth / 2 + overhang;
  const alongX = width >= depth;
  const majorHalf = alongX ? halfW : halfD;
  const minorHalf = alongX ? halfD : halfW;
  const ridgeHalf = Math.max(majorHalf - minorHalf, Math.min(majorHalf, minorHalf) * 0.15, 0.1);

  const e1 = [-halfW, 0, -halfD], e2 = [halfW, 0, -halfD], e3 = [halfW, 0, halfD], e4 = [-halfW, 0, halfD];
  const r1 = alongX ? [-ridgeHalf, ridgeHeight, 0] : [0, ridgeHeight, -ridgeHalf];
  const r2 = alongX ? [ridgeHalf, ridgeHeight, 0] : [0, ridgeHeight, ridgeHalf];

  const tris = [];
  const addQuad = (a, b, c, d) => tris.push(a, b, c, a, c, d);
  const addTri = (a, b, c) => tris.push(a, b, c);

  if (alongX) {
    addQuad(e1, e2, r2, r1); // front slope (-Z)
    addQuad(e3, e4, r1, r2); // back slope (+Z)
    addTri(e4, e1, r1);      // left hip (-X)
    addTri(e2, e3, r2);      // right hip (+X)
  } else {
    addQuad(e2, e3, r2, r1); // right slope (+X)
    addQuad(e4, e1, r1, r2); // left slope (-X)
    addTri(e1, e2, r1);      // front hip (-Z)
    addTri(e3, e4, r2);      // back hip (+Z)
  }

  const positions = new Float32Array(tris.length * 3);
  const uvs = new Float32Array(tris.length * 2);
  tris.forEach((v, i) => {
    positions[i * 3] = v[0]; positions[i * 3 + 1] = v[1]; positions[i * 3 + 2] = v[2];
    // Planar XZ projection for the shingle texture — a simple, cheap UV
    // scheme that's a reasonable approximation for a low-pitch hip roof.
    uvs[i * 2] = (v[0] + halfW) / (halfW * 2 || 1);
    uvs[i * 2 + 1] = (v[2] + halfD) / (halfD * 2 || 1);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();

  const mat = makeRoofMaterial(color);
  mat.side = THREE.DoubleSide; // robust to any face winding, since the underside is never meant to be seen anyway
  const mesh = new THREE.Mesh(geometry, mat);
  const [cx, cy, cz] = position;
  mesh.position.set(cx, cy, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.group = group;
  mesh.userData.room = null;
  mesh.userData.material = material;
  if (floor != null) mesh.userData.floor = floor;
  mesh.userData.originalPosition = mesh.position.clone();
  mesh.userData.originalRotationY = 0;
  return mesh;
}

// White fascia board tracing the eave perimeter of a hip roof — the crisp
// painted trim line that separates a dark roof from the walls below it in
// real finished elevations. Purely decorative dressing, same spirit as the
// corner pilasters/plinth already added per floor.
function buildRoofFascia({ width, depth, overhang, position, color = '#f4f1e6', floor }) {
  const halfW = width / 2 + overhang;
  const halfD = depth / 2 + overhang;
  const [cx, cy, cz] = position;
  const boardH = 0.1;
  const boardT = 0.05;
  const mat = makeMaterial('metal', color);
  mat.roughness = 0.5;
  const meshes = [];
  const addBoard = (bw, bx, bz, rotY) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, boardH, boardT), mat);
    m.position.set(cx + bx, cy - boardH / 2 + 0.015, cz + bz);
    m.rotation.y = rotY;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.group = 'roof';
    m.userData.room = null;
    m.userData.material = 'metal';
    if (floor != null) m.userData.floor = floor;
    m.userData.originalPosition = m.position.clone();
    m.userData.originalRotationY = rotY;
    meshes.push(m);
  };
  addBoard(halfW * 2 + boardT, 0, -halfD, 0);
  addBoard(halfW * 2 + boardT, 0, halfD, 0);
  addBoard(halfD * 2 + boardT, -halfW, 0, Math.PI / 2);
  addBoard(halfD * 2 + boardT, halfW, 0, Math.PI / 2);
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
    const isGarage = isDoor && (part.size?.[0] ?? 0) >= 2.2;
    const fillGeo = isDoor
      ? new RoundedBoxGeometry(fillDims[0], fillDims[1], fillDims[2], 1, Math.min(0.02, fillDims[0] * 0.05))
      : new THREE.BoxGeometry(fillDims[0], fillDims[1], fillDims[2]);
    const fillMesh = new THREE.Mesh(fillGeo, makeMaterial(
      part.material || (isGarage ? 'metal' : isDoor ? 'wood' : 'glass'),
      part.color || (isGarage ? '#d9d9d2' : undefined)
    ));
    fillMesh.position.set(x, y, z);
    fillMesh.castShadow = isDoor;
    fillMesh.receiveShadow = true;
    fillMesh.userData.group = part.group || 'window';
    fillMesh.userData.room = part.room || null;
    fillMesh.userData.material = part.material || (isGarage ? 'metal' : isDoor ? 'wood' : 'glass');
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

  shellBrush.material = makeSidingMaterial(structurePart.color);
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
  // Interior partition walls (routed here from buildInteriorWallWithDoors so
  // a door cut into a partition gets the same real-CSG treatment as an
  // exterior door) get the smoother interior paint finish; every other wall
  // through this path — manual-modeler exterior walls, AI structure walls —
  // gets exterior board siding.
  const wallMaterial = () => (wallPart.group === 'interior' ? makeInteriorPaintMaterial(wallPart.color) : makeSidingMaterial(wallPart.color));

  const wallBrush = new Brush(new THREE.BoxGeometry(w, h, d));
  wallBrush.position.set(wx, wy, wz);
  wallBrush.rotation.y = rotY;
  wallBrush.updateMatrixWorld();

  if (!openingParts.length) {
    const solid = new THREE.Mesh(wallBrush.geometry, wallMaterial());
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
    const isGarage = isDoor && ow >= 2.2;

    const cutter = new Brush(new THREE.BoxGeometry(ow, oh, Math.max(od, d * 3)));
    cutter.position.set(ox, oy, oz);
    cutter.rotation.y = rotY;
    cutter.updateMatrixWorld();
    shellBrush = evaluator.evaluate(shellBrush, cutter, SUBTRACTION);

    const fillMesh = new THREE.Mesh(
      new THREE.BoxGeometry(ow * 0.94, oh, Math.max(d * 0.85, 0.04)),
      makeMaterial(part.material || (isGarage ? 'metal' : isDoor ? 'wood' : 'glass'), part.color || (isGarage ? '#d9d9d2' : undefined))
    );
    fillMesh.position.set(ox, oy, oz);
    fillMesh.rotation.y = rotY;
    fillMesh.castShadow = isDoor;
    fillMesh.receiveShadow = true;
    fillMesh.userData.group = part.group;
    fillMesh.userData.room = part.room || null;
    fillMesh.userData.material = part.material || (isGarage ? 'metal' : isDoor ? 'wood' : 'glass');
    fillMesh.userData.originalPosition = fillMesh.position.clone();
    fillMesh.userData.originalRotationY = fillMesh.rotation.y;
    fillMeshes.push(fillMesh);

    const detailMeshes = buildOpeningDetail({
      group: part.group, dims: [ow, oh, Math.max(od, 0.06)], position: [ox, oy, oz], rotY,
      material: part.material, color: part.color, room: part.room || null,
    });
    fillMeshes.push(...detailMeshes);
  }

  shellBrush.material = wallMaterial();
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
    // Roof parts carry width/depth/ridgeHeight/overhang instead of a
    // generic box `size` — buildHipRoofMesh already exists and is used by
    // the AI/blueprint pipeline's real roof geometry, so the manual
    // modeler's Roof tool reuses that exact function instead of
    // approximating a roof shape with a tilted box.
    const m = p.type === 'hip-roof'
      ? buildHipRoofMesh({
          width: p.width, depth: p.depth, ridgeHeight: p.ridgeHeight, overhang: p.overhang,
          position: p.position, material: p.material, color: p.color, group: 'roof', floor: p.floor,
        })
      : buildMesh(p);
    // buildHipRoofMesh has no rotation parameter at all (it always builds
    // aligned to whichever of width/depth is larger, and hardcodes
    // userData.originalRotationY to 0) — applied here instead, or a
    // user-rotated roof would visually snap back to 0 on every rebuild
    // (undo/redo, reload, switching floors) despite the gizmo drag having
    // "worked" in the moment and the rotation having been committed into
    // the part's own saved state.
    if (p.type === 'hip-roof' && p.rotation) {
      m.rotation.y = p.rotation;
      m.userData.originalRotationY = p.rotation;
    }
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
  return isWallShapedPart(p);
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

// ---------------------------------------------------------------------------
// Corner pilasters: a banded vertical column straddling each of a floor's
// four corners, in a contrasting dark tone with light horizontal accent
// bands — the single detail that most separates a "flat colored box" render
// from the crisp, banded-corner look of a real elevation rendering. Applied
// procedurally to every floor of every building, regardless of what the AI
// specified, exactly like the existing string-course/plinth trim below.
// ---------------------------------------------------------------------------
function addCornerPilasters(meshes, envelope, floorNum) {
  const [ew, eh, ed] = envelope.size || [4, 3, 4];
  const [ecx, ecy, ecz] = envelope.position || [0, eh / 2, 0];
  const pilW = Math.min(0.5, Math.max(0.26, Math.min(ew, ed) * 0.06));
  const baseY = ecy - eh / 2;
  const color = '#333849';
  const bandColor = '#e7e3d6';
  const corners = [
    [ecx - ew / 2 + pilW / 2, ecz - ed / 2 + pilW / 2],
    [ecx + ew / 2 - pilW / 2, ecz - ed / 2 + pilW / 2],
    [ecx - ew / 2 + pilW / 2, ecz + ed / 2 - pilW / 2],
    [ecx + ew / 2 - pilW / 2, ecz + ed / 2 - pilW / 2],
  ];
  corners.forEach(([cx, cz]) => {
    const pilaster = makeTrimMesh({
      geometry: new THREE.BoxGeometry(pilW, eh, pilW),
      x: cx, y: baseY + eh / 2, z: cz, material: 'metal', color, group: 'structure',
    });
    pilaster.userData.floor = floorNum;
    meshes.push(pilaster);
    const bands = 3;
    for (let i = 1; i <= bands; i++) {
      const band = makeTrimMesh({
        geometry: new THREE.BoxGeometry(pilW + 0.012, 0.035, pilW + 0.012),
        x: cx, y: baseY + (eh * i) / (bands + 1), z: cz, material: 'metal', color: bandColor, group: 'structure', castShadow: false,
      });
      band.userData.floor = floorNum;
      meshes.push(band);
    }
  });
}

// ---------------------------------------------------------------------------
// Skirting board: a thin trim strip at the base of a partition wall, in a
// finish tone distinct from the wall itself — a small, cheap detail that
// reads as "professionally finished interior" instead of bare CSG-cut
// partitions, matching the level of finish the exterior corner
// pilasters/plinth already give the outside of the building.
// ---------------------------------------------------------------------------
function addSkirtingForWall(meshes, wallPart, floorNum) {
  const [ww, wh, wd] = wallPart.size || [0.1, 3, 4];
  const [wx, wy, wz] = wallPart.position || [0, wh / 2, 0];
  const thinIsX = ww < wd;
  const length = thinIsX ? wd : ww;
  const thick = (thinIsX ? ww : wd) + 0.02;
  const baseY = wy - wh / 2;
  const geo = thinIsX ? new THREE.BoxGeometry(thick, 0.09, length) : new THREE.BoxGeometry(length, 0.09, thick);
  const skirting = makeTrimMesh({
    geometry: geo, x: wx, y: baseY + 0.045, z: wz,
    material: 'metal', color: '#e9e6dc', group: 'interior', room: wallPart.room || null, castShadow: false,
  });
  skirting.userData.floor = floorNum;
  meshes.push(skirting);
}

// Builds one building's full mesh list (walls w/ real cutouts, floors,
// roof, balconies) from its modelSpec.parts — shared by the single-building
// editor and the multi-building estate viewer so both produce identical
// geometry quality.
export function buildBuildingMeshes(rawParts) {
  // AI-authored partition walls almost always come through as material
  // "wood" with no explicit color (that's just the schema's generic
  // fallback), which renders as a strong golden-pine tone that clashes with
  // a light exterior palette and reads as unfinished rather than "well
  // partitioned". Give any wall-shaped interior part a clean off-white
  // finish by default unless the AI (or a template) chose a color on
  // purpose — floor slabs (flat, not wall-shaped) are untouched and keep
  // their warm wood-floor look.
  const parts = rawParts.map(p => {
    if (p.group === 'interior' && !p.color && isPartitionWall(p)) {
      return { ...p, color: '#eef0ea' };
    }
    return p;
  });
  const openingParts = parts.filter(p => p.group === 'door' || p.group === 'window');
  const structureParts = parts.filter(p => p.group === 'structure' || !p.group);
  const interiorDoorParts = parts.filter(p => p.group === 'interior-door');
  const otherPartsAll = parts.filter(p => p.group && p.group !== 'structure' && p.group !== 'door' && p.group !== 'window' && p.group !== 'interior-door');
  const roofParts = otherPartsAll.filter(p => p.group === 'roof');
  const otherParts = otherPartsAll.filter(p => p.group !== 'roof');
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
      addCornerPilasters(meshes, envelope, floorNum);
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
    addSkirtingForWall(meshes, wall, wall.floor ?? 1);
  });
  nonPartitionOther.forEach(p => {
    if (p.group === 'balcony') {
      const bMeshes = buildBalconyMeshes(p);
      bMeshes.forEach(m => { m.userData.floor = p.floor ?? 1; });
      meshes.push(...bMeshes);
      return;
    }
    if (p.group === 'pool') {
      const poolMeshes = buildPoolMesh(p);
      poolMeshes.forEach(m => { m.userData.floor = p.floor ?? 1; });
      meshes.push(...poolMeshes);
      return;
    }
    const m = buildMesh(p);
    m.userData.floor = p.floor ?? 1;
    m.userData.room = p.room || null;
    meshes.push(m);
  });

  // Roofs: a "cylinder" part with a near-zero radiusTop is the encoded
  // convention for "hip roof" used throughout the AI prompt and the offline
  // templates — swap that cone approximation for a real hip roof matched to
  // its floor's actual footprint. A box roof, or a genuine cylinder (equal
  // top/bottom radius, e.g. a turret), is left as an ordinary mesh.
  roofParts.forEach(p => {
    const isConeConvention = p.type === 'cylinder' && (p.radiusTop ?? 0) < Math.max(0.05, (p.radiusBottom ?? 1) * 0.05);
    if (!isConeConvention) {
      const m = buildMesh(p);
      m.userData.floor = p.floor ?? 1;
      meshes.push(m);
      return;
    }
    const roofFloor = p.floor ?? floorNumbers[floorNumbers.length - 1] ?? 1;
    const envelope = structureParts.find(sp => (sp.floor ?? 1) === roofFloor) || structureParts[structureParts.length - 1];
    const [ew, eh, ed] = envelope?.size || [(p.radiusBottom || 4) * 1.4, 3, (p.radiusBottom || 4) * 1.4];
    const [ecx, ecy, ecz] = envelope?.position || [0, eh / 2, 0];
    const baseY = ecy + eh / 2;
    const overhang = Math.min(0.5, Math.max(0.3, Math.min(ew, ed) * 0.05));
    const ridgeHeight = Math.max(0.6, p.height || 1.6);
    const [px, , pz] = p.position || [ecx, 0, ecz];
    meshes.push(buildHipRoofMesh({
      width: ew, depth: ed, ridgeHeight, overhang,
      position: [px, baseY, pz],
      material: p.material || 'metal', color: p.color, floor: roofFloor,
    }));
    meshes.push(...buildRoofFascia({ width: ew, depth: ed, overhang, position: [px, baseY, pz], floor: roofFloor }));
  });

  return meshes;
}
