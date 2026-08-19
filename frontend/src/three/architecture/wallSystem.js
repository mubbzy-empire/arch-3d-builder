// ---------------------------------------------------------------------------
// wallSystem.js
//
// Builds one wall's mesh from its actual segment (start/end/thickness/
// height), extended slightly at endpoints that meet another wall on the
// same floor so corners close cleanly (no gap, no double-thickness gap),
// then CSG-subtracts every attached opening and adds that opening's frame/
// glazing/door fill. This replaces the old "whole building = one big box,
// hollow it out" approach — every wall here is its own real segment.
//
// PHASE 2: a wall is no longer rendered as one flat-colored slab. Its real
// construction assembly (constructionAssemblies.js) is resolved and, where
// it has more than one layer (e.g. render / block core / plaster — the
// normal case for an exterior wall), the wall is built as that many
// separate slabs stacked across its thickness, each with the material a
// professional would expect (painted render outside, raw block or concrete
// core, plaster/board finish inside) — the same way a real wall section
// reads. A thin partition or a single-material assembly (reinforced
// concrete, curtain-wall glazing) still renders as one solid, since there's
// nothing meaningful to separate.
//
// Layer order in the assembly is authored exterior -> interior. This
// module places layer 0 toward the wall's outward-facing side, which for
// any wall built by walking a CCW building footprint (the convention this
// engine's footprints already use — see buildingModel.js) is the
// "positive lateral" / right-hand-normal side of the segment. For a
// free-standing or hand-edited wall where that assumption doesn't hold,
// the layering still looks correct (still a real, distinct render/core/
// finish sandwich) — only which literal face is "outside" can end up
// mirrored, which is a cosmetic detail, not a structural one.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { wallLength, wallAngle, wallMidpoint } from './buildingModel.js';
import { exteriorMaterial, interiorMaterial } from './materialSystem.js';
import { buildOpeningCut, buildOpeningFill } from './openingSystem.js';
import { assemblyForWall, scaledWallLayers, materialVisualKind } from './constructionAssemblies.js';

const EPS = 0.03;

function pointsClose(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS;
}

// Extend a wall's endpoints by half the thickness of whichever wall(s) they
// meet, so two walls that share a corner point overlap slightly instead of
// leaving a gap or a visible seam — the standard "butt corner" convention
// used in real construction drawings.
function extendedEndpoints(wall, allWallsOnFloor) {
  let [sx, sz] = wall.start;
  let [ex, ez] = wall.end;
  const len = wallLength(wall) || 1;
  const ux = (ex - sx) / len, uz = (ez - sz) / len;

  const meetsAtStart = allWallsOnFloor.some((w) => w !== wall && (pointsClose(w.start, wall.start) || pointsClose(w.end, wall.start)));
  const meetsAtEnd = allWallsOnFloor.some((w) => w !== wall && (pointsClose(w.start, wall.end) || pointsClose(w.end, wall.end)));

  if (meetsAtStart) { sx -= ux * (wall.thickness / 2); sz -= uz * (wall.thickness / 2); }
  if (meetsAtEnd) { ex += ux * (wall.thickness / 2); ez += uz * (wall.thickness / 2); }
  return { start: [sx, sz], end: [ex, ez] };
}

// World-space (x,z) delta for a purely lateral (local-Z) offset of
// `lateral` metres, given the wall's own Y rotation — computed via
// Three's own quaternion math rather than hand-derived trig, so it's
// guaranteed consistent with however the wall's box geometry itself gets
// rotated into place.
const _q = new THREE.Quaternion();
const _axisY = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
function lateralWorldOffset(rotY, lateral) {
  _q.setFromAxisAngle(_axisY, rotY);
  _v.set(0, 0, lateral).applyQuaternion(_q);
  return [_v.x, _v.z];
}

function resolveLayerMaterial(layer, wall) {
  const kind = materialVisualKind(layer.material);
  // Only a *finish* layer (render, plaster, board) ever takes the wall's
  // own paint-swatch color — that's "the wall's color" from a user's point
  // of view, for an exterior wall or an interior partition alike. The
  // structural core (raw block/concrete) always keeps its natural preset
  // tone, so the sandwich reads as distinct real materials rather than one
  // color repeated across every layer.
  const useWallColor = layer.role === 'finish' && !!wall.color;
  return layer.side === 'interior'
    ? interiorMaterial(kind === 'wood' ? 'wood-flooring' : 'plaster', useWallColor ? wall.color : undefined)
    : exteriorMaterial(kind, useWallColor ? wall.color : undefined);
}

// Builds one layer's brush (a Box the size of this layer's slice of the
// wall, offset laterally so the whole stack fills the wall's real
// thickness), CSG-cutting every opening through it if the wall has any.
function buildLayerMesh(ctx, layer, centerLateral, wall, evaluator) {
  const { len, height, midY, mx, mz, rotY } = ctx;
  const [ox, oz] = lateralWorldOffset(rotY, centerLateral);
  const px = mx + ox, pz = mz + oz;

  if (!wall.openings.length) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, height, layer.thickness), resolveLayerMaterial(layer, wall));
    mesh.position.set(px, midY, pz);
    mesh.rotation.y = rotY;
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  let brush = new Brush(new THREE.BoxGeometry(len, height, layer.thickness));
  brush.position.set(px, midY, pz);
  brush.rotation.y = rotY;
  brush.updateMatrixWorld();
  for (const opening of wall.openings) {
    const cut = buildOpeningCut(wall, opening);
    const cutter = new Brush(new THREE.BoxGeometry(cut.size[0], cut.size[1], cut.size[2]));
    cutter.position.set(cut.position[0], cut.position[1], cut.position[2]);
    cutter.rotation.y = cut.rotY;
    cutter.updateMatrixWorld();
    brush = evaluator.evaluate(brush, cutter, SUBTRACTION);
  }
  brush.material = resolveLayerMaterial(layer, wall);
  brush.castShadow = true; brush.receiveShadow = true;
  return brush;
}

function tagMesh(mesh, wall, assembly, layer) {
  mesh.userData.group = 'structure';
  mesh.userData.wallId = wall.id;
  mesh.userData.wallType = wall.type;
  mesh.userData.floor = wall.floor;
  mesh.userData.material = layer ? layer.material : (wall.material || 'plaster');
  mesh.userData.assembly = assembly.label;
  mesh.userData.assemblyLayers = assembly.layers;
  if (layer) mesh.userData.layerRole = layer.role;
}

function finishGroup(group, wall) {
  group.name = `wall_${wall.id}`;
  return group;
}

export function buildWallGroup(wall, allWallsOnFloor = []) {
  const { start, end } = extendedEndpoints(wall, allWallsOnFloor);
  const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const rotY = wallAngle(wall);
  const [mx, mz] = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const midY = wall.baseElevation + wall.height / 2;
  const assembly = assemblyForWall(wall);
  const layers = scaledWallLayers(wall); // null => render as one solid, below

  const group = new THREE.Group();
  group.userData.group = 'structure';
  group.userData.wallId = wall.id;
  group.userData.wallType = wall.type;
  group.userData.floor = wall.floor;
  // The group itself never carries its own offset at build time (each
  // child mesh is positioned directly) — recorded so the viewer's "reset
  // positions" can restore a wall that was dragged as a whole (see
  // ModelViewer.jsx groupsRef), matching how individual meshes already
  // track userData.originalPosition/originalRotationY below.
  group.userData.originalPosition = new THREE.Vector3(0, 0, 0);
  group.userData.originalRotationY = 0;

  if (len < 0.02) return group; // degenerate wall, skip

  const ctx = { len, height: wall.height, midY, mx, mz, rotY };

  if (!layers) {
    // Single-material wall (thin partition, reinforced concrete, glazing,
    // or an assembly with nothing worth splitting) — the original one-slab
    // path, now just tagged with its resolved assembly for the info panel.
    const material = wall.type === 'interior'
      ? interiorMaterial('plaster', wall.color)
      : exteriorMaterial(wall.material || 'plaster', wall.color);
    const materialLabelStr = wall.type === 'interior' ? 'plaster' : (wall.material || 'plaster');

    if (!wall.openings.length) {
      const solid = new THREE.Mesh(new THREE.BoxGeometry(len, wall.height, wall.thickness), material);
      solid.position.set(mx, midY, mz);
      solid.rotation.y = rotY;
      solid.castShadow = true; solid.receiveShadow = true;
      tagMesh(solid, wall, assembly, null);
      solid.userData.material = materialLabelStr;
      solid.userData.originalPosition = solid.position.clone();
      solid.userData.originalRotationY = rotY;
      group.add(solid);
      return finishGroup(group, wall);
    }

    const evaluator = new Evaluator();
    let shell = new Brush(new THREE.BoxGeometry(len, wall.height, wall.thickness));
    shell.position.set(mx, midY, mz);
    shell.rotation.y = rotY;
    shell.updateMatrixWorld();
    for (const opening of wall.openings) {
      const cut = buildOpeningCut(wall, opening);
      const cutter = new Brush(new THREE.BoxGeometry(cut.size[0], cut.size[1], cut.size[2]));
      cutter.position.set(cut.position[0], cut.position[1], cut.position[2]);
      cutter.rotation.y = cut.rotY;
      cutter.updateMatrixWorld();
      shell = evaluator.evaluate(shell, cutter, SUBTRACTION);
    }
    shell.material = material;
    shell.castShadow = true; shell.receiveShadow = true;
    tagMesh(shell, wall, assembly, null);
    shell.userData.material = materialLabelStr;
    shell.userData.originalPosition = shell.position.clone();
    shell.userData.originalRotationY = rotY;
    group.add(shell);
    for (const opening of wall.openings) group.add(buildOpeningFill(wall, opening));
    return finishGroup(group, wall);
  }

  // Layered wall: stack each assembly layer across the wall's real
  // thickness, outermost (index 0, authored "exterior") toward the
  // positive-lateral / outward face.
  const evaluator = new Evaluator();
  const halfT = wall.thickness / 2;
  let running = halfT;
  for (const layer of layers) {
    const centerLateral = running - layer.thickness / 2;
    running -= layer.thickness;
    const mesh = buildLayerMesh(ctx, layer, centerLateral, wall, evaluator);
    tagMesh(mesh, wall, assembly, layer);
    mesh.userData.originalPosition = mesh.position.clone();
    mesh.userData.originalRotationY = rotY;
    group.add(mesh);
  }
  for (const opening of wall.openings) group.add(buildOpeningFill(wall, opening));
  return finishGroup(group, wall);
}

// Builds every wall on one level, returning a single group. Openings are
// already embedded per-wall, so this is just "for each wall, build it".
export function buildLevelWalls(level) {
  const group = new THREE.Group();
  group.name = `walls_floor_${level.index}`;
  for (const wall of level.walls) {
    group.add(buildWallGroup(wall, level.walls));
  }
  return group;
}
