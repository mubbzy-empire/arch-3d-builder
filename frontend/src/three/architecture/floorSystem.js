// ---------------------------------------------------------------------------
// floorSystem.js
//
// Real slabs generated from a level's footprint polygon, plus interior
// floor finish and ceiling planes per room so "show interior" reveals an
// actual finished room rather than the inside of a hollow box.
//
// PHASE 2: the ground/suspended slab is now tagged with its real
// FLOOR_ASSEMBLIES spec (constructionAssemblies.js) — the same one the
// bill-of-quantities counts — and its rendered thickness defaults to that
// assembly's actual total thickness instead of a flat guess, so a ground
// floor (hardcore + DPM + slab + screed, ~280mm) reads as measurably
// different from a suspended upper floor (~150mm) rather than both being
// an identical 200mm box. Room floor finishes get the matching treatment
// via FINISH_ASSEMBLY_BY_KIND below.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { interiorMaterial, exteriorMaterial } from './materialSystem.js';
import { assemblyForFloor, FLOOR_ASSEMBLIES } from './constructionAssemblies.js';

function footprintShape(footprint) {
  const shape = new THREE.Shape();
  footprint.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z)));
  shape.closePath();
  return shape;
}

export function buildSlabMesh(level, { thickness, isGround = false } = {}) {
  const assembly = assemblyForFloor(level);
  const realThickness = thickness ?? assembly.totalThickness ?? 0.2;
  const shape = footprintShape(level.footprint);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: realThickness, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, level.elevation - realThickness, 0);
  const mat = isGround ? exteriorMaterial('concrete', '#b9b6ad') : interiorMaterial('concrete', '#c9c6bd');
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.group = 'slab';
  mesh.userData.floor = level.index;
  mesh.userData.material = 'concrete';
  mesh.userData.assembly = assembly.label;
  mesh.userData.assemblyLayers = assembly.layers;
  return mesh;
}

// Maps the same interior-finish key the renderer already accepts
// (materialSystem.js's INTERIOR_PRESETS — 'tile', 'marble', 'wood-flooring',
// 'ceramic', ...) onto the matching real FLOOR_ASSEMBLIES finish spec, so a
// room's floor reports a real, buildable finish ("Ceramic Floor Tile
// Finish") instead of just a render-time colour preset name.
const FINISH_ASSEMBLY_BY_KIND = {
  tile: FLOOR_ASSEMBLIES['ceramic-tile-finish'],
  ceramic: FLOOR_ASSEMBLIES['ceramic-tile-finish'],
  marble: FLOOR_ASSEMBLIES['ceramic-tile-finish'],
  'wood-flooring': FLOOR_ASSEMBLIES['timber-floor-finish'],
};

export function buildRoomFloorAndCeiling(room, level, floorFinish = 'tile') {
  const group = new THREE.Group();
  group.userData.group = 'interior';
  group.userData.room = room.name;
  if (!room.polygon || room.polygon.length < 3) return group;

  const finishAssembly = FINISH_ASSEMBLY_BY_KIND[floorFinish];

  const shape = footprintShape(room.polygon);
  const floorGeo = new THREE.ShapeGeometry(shape);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMesh = new THREE.Mesh(floorGeo, interiorMaterial(floorFinish, undefined));
  floorMesh.position.y = level.elevation + 0.01;
  floorMesh.receiveShadow = true;
  floorMesh.userData.group = 'interior';
  floorMesh.userData.room = room.name;
  floorMesh.userData.material = floorFinish;
  if (finishAssembly) {
    floorMesh.userData.assembly = finishAssembly.label;
    floorMesh.userData.assemblyLayers = finishAssembly.layers;
  }
  group.add(floorMesh);

  const ceilH = room.ceilingHeight || level.height - 0.05;
  const ceilGeo = new THREE.ShapeGeometry(shape);
  ceilGeo.rotateX(Math.PI / 2);
  const ceilMesh = new THREE.Mesh(ceilGeo, interiorMaterial('ceiling'));
  ceilMesh.position.y = level.elevation + ceilH;
  ceilMesh.userData.group = 'interior';
  ceilMesh.userData.room = room.name;
  group.add(ceilMesh);

  // Skirting board around the room perimeter — small but it's the detail
  // that stops a finished floor from reading as a raw box interior.
  const skirtMat = interiorMaterial('plaster', '#ffffff');
  for (let i = 0; i < room.polygon.length; i++) {
    const [x1, z1] = room.polygon[i];
    const [x2, z2] = room.polygon[(i + 1) % room.polygon.length];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.05) continue;
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.015), skirtMat);
    skirt.position.set((x1 + x2) / 2, level.elevation + 0.04, (z1 + z2) / 2);
    skirt.rotation.y = Math.atan2(x2 - x1, z2 - z1);
    group.add(skirt);
  }
  return group;
}
