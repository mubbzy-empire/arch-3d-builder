// ---------------------------------------------------------------------------
// roofSystem.js
//
// Real roof planes generated from the actual top-floor footprint, instead
// of a generic cone/cylinder fallback. Supports the rectangular case
// (by far the most common for residential footprints, including setback
// upper floors) with hip, gable, flat/parapet, and mono-pitch forms.
// Non-rectangular footprints fall back to a flat parapet roof, which is
// always geometrically valid even if less decorative — a known Phase-1
// limitation called out in the delivery notes, not silently patched over.
//
// PHASE 2: every roof now also gets the finished trim a real roof actually
// has at its edges — an eave gutter (rainwater has to go somewhere) and a
// ridge cap along the ridge line — and is tagged with the same real
// covering spec (constructionAssemblies.js's ROOF_ASSEMBLIES) that backs
// the bill-of-quantities, so clicking the roof in the viewer reports the
// same "aluminium long-span sheet" or "concrete interlocking tile" the BOQ
// counts, not just a paint-color label.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { roofMaterial, exteriorMaterial, frameMaterial } from './materialSystem.js';
import { assemblyForRoof } from './constructionAssemblies.js';

function footprintBounds(footprint) {
  const xs = footprint.map((p) => p[0]);
  const zs = footprint.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

function isRectangular(footprint) {
  return footprint.length === 4;
}

// A gutter running the length `len` along local Z, dropped just under the
// eave edge. Built once and reused (rotated/positioned by the caller) so
// every roof type shares one real cross-section instead of each hand-
// rolling its own box.
function makeGutterSegment(len) {
  const mat = frameMaterial('aluminium', '#8b8f93');
  const g = new THREE.Group();
  const trough = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, len), mat);
  trough.userData.group = 'roof';
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, len), mat);
  lip.position.y = 0.05;
  lip.userData.group = 'roof';
  g.add(trough, lip);
  g.userData.group = 'roof';
  return g;
}

function tagRoof(mesh, assembly) {
  mesh.userData.group = 'roof';
  mesh.userData.assembly = assembly.label;
  mesh.userData.assemblyLayers = assembly.layers;
}

export function buildRoofGroup(topLevel, roof, baseY) {
  const group = new THREE.Group();
  group.name = 'roof';
  group.userData.group = 'roof';

  const b = footprintBounds(topLevel.footprint);
  const { width, depth } = b;
  const overhang = roof.overhang ?? 0.5;
  const assembly = assemblyForRoof(roof);

  let roofGroup;
  if (roof.type === 'flat' || roof.type === 'parapet' || !isRectangular(topLevel.footprint)) {
    roofGroup = buildFlatRoof(b, baseY, roof, assembly);
  } else if (roof.type === 'gable') {
    roofGroup = buildGableRoof(b, baseY, roof, assembly);
  } else if (roof.type === 'mono') {
    roofGroup = buildMonoRoof(b, baseY, roof, assembly);
  } else {
    roofGroup = buildHipRoof(b, baseY, roof, assembly); // default: hip
  }
  group.add(roofGroup);
  return group;
}

function buildFlatRoof(b, baseY, roof, assembly) {
  const group = new THREE.Group();
  const slabT = 0.2;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(b.width + roof.overhang * 2, slabT, b.depth + roof.overhang * 2),
    roofMaterial(roof.material, roof.color || '#c9c6bd'),
  );
  slab.position.set(b.cx, baseY + slabT / 2, b.cz);
  slab.castShadow = true; slab.receiveShadow = true;
  tagRoof(slab, assembly);
  group.add(slab);

  const parapetH = roof.parapetHeight ?? 0.9;
  if (parapetH > 0) {
    const wallT = 0.15;
    const parapetMat = exteriorMaterial('plaster', roof.color);
    const mk = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, parapetH, d), parapetMat);
      m.position.set(x, baseY + slabT + parapetH / 2, z);
      m.castShadow = true; m.receiveShadow = true;
      tagRoof(m, assembly);
      return m;
    };
    group.add(mk(b.width + wallT, wallT, b.cx, b.minZ - wallT / 2));
    group.add(mk(b.width + wallT, wallT, b.cx, b.maxZ + wallT / 2));
    group.add(mk(wallT, b.depth + wallT, b.minX - wallT / 2, b.cz));
    group.add(mk(wallT, b.depth + wallT, b.maxX + wallT / 2, b.cz));
  } else {
    // No parapet to hide the edge — a flat roof still needs a drip edge/
    // gutter around its perimeter or rainwater just sheets off the slab
    // face, which is how a real flat roof actually gets finished.
    const perim = [
      { len: b.width + roof.overhang * 2, x: b.cx, z: b.minZ - roof.overhang, rotY: 0 },
      { len: b.width + roof.overhang * 2, x: b.cx, z: b.maxZ + roof.overhang, rotY: 0 },
      { len: b.depth + roof.overhang * 2, x: b.minX - roof.overhang, z: b.cz, rotY: Math.PI / 2 },
      { len: b.depth + roof.overhang * 2, x: b.maxX + roof.overhang, z: b.cz, rotY: Math.PI / 2 },
    ];
    for (const p of perim) {
      const seg = makeGutterSegment(p.len);
      seg.position.set(p.x, baseY - 0.05, p.z);
      seg.rotation.y = p.rotY;
      group.add(seg);
    }
  }
  return group;
}

function buildHipRoof(b, baseY, roof, assembly) {
  const group = new THREE.Group();
  const ridgeHeight = Math.max(0.6, (Math.min(b.width, b.depth) / 2) * Math.tan((roof.pitchDeg * Math.PI) / 180));
  const ow = b.width + roof.overhang * 2, od = b.depth + roof.overhang * 2;
  const ridgeFrac = 0.35; // ridge line runs this fraction of the shorter footprint dimension
  const shape = ow >= od;
  const ridgeLen = (shape ? ow : od) * ridgeFrac;

  const geometry = new THREE.BufferGeometry();
  const hw = ow / 2, hd = od / 2;
  const rh = ridgeLen / 2;
  let verts, idx;
  if (shape) {
    // ridge runs along X
    verts = new Float32Array([
      -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd, // eave corners 0-3
      -rh, ridgeHeight, 0, rh, ridgeHeight, 0, // ridge 4-5
    ]);
    idx = [0, 1, 5, 0, 5, 4, 1, 2, 5, 2, 3, 4, 3, 0, 4, 5, 3, 4, 5, 2, 3];
  } else {
    verts = new Float32Array([
      -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd,
      0, ridgeHeight, -rh, 0, ridgeHeight, rh,
    ]);
    idx = [0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 3, 5, 4, 3, 4, 0];
  }
  geometry.setIndex(idx);
  geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, roofMaterial(roof.material, roof.color));
  mesh.position.set(b.cx, baseY, b.cz);
  mesh.castShadow = true; mesh.receiveShadow = true;
  tagRoof(mesh, assembly);
  group.add(mesh);

  // Fascia board around the eave line for a finished edge.
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(ow, 0.15, od), exteriorMaterial('wood', '#5a4530'));
  fascia.position.set(b.cx, baseY - 0.02, b.cz);
  tagRoof(fascia, assembly);
  group.add(fascia);

  // Ridge cap — a short trim piece along the actual ridge line, at the
  // real ridge height, oriented with the ridge axis.
  const ridgeCap = new THREE.Mesh(new THREE.BoxGeometry(shape ? ridgeLen + 0.1 : 0.14, 0.08, shape ? 0.14 : ridgeLen + 0.1), frameMaterial('aluminium', roof.color || '#7a5240'));
  ridgeCap.position.set(b.cx, baseY + ridgeHeight + 0.04, b.cz);
  tagRoof(ridgeCap, assembly);
  group.add(ridgeCap);

  // Eave gutter around all four sides — a hip roof drains on every edge.
  const perim = [
    { len: ow, x: b.cx, z: b.minZ - overhangSafe(roof), rotY: 0 },
    { len: ow, x: b.cx, z: b.maxZ + overhangSafe(roof), rotY: 0 },
    { len: od, x: b.minX - overhangSafe(roof), z: b.cz, rotY: Math.PI / 2 },
    { len: od, x: b.maxX + overhangSafe(roof), z: b.cz, rotY: Math.PI / 2 },
  ];
  for (const p of perim) {
    const seg = makeGutterSegment(p.len);
    seg.position.set(p.x, baseY - 0.1, p.z);
    seg.rotation.y = p.rotY;
    group.add(seg);
  }
  return group;
}

function overhangSafe(roof) {
  return roof.overhang ?? 0.5;
}

function buildGableRoof(b, baseY, roof, assembly) {
  const group = new THREE.Group();
  const ridgeHeight = Math.max(0.6, (b.depth / 2) * Math.tan((roof.pitchDeg * Math.PI) / 180));
  const ow = b.width + roof.overhang * 2;
  const hw = ow / 2, hd = b.depth / 2 + roof.overhang;

  const shape2d = new THREE.Shape();
  shape2d.moveTo(-hd, 0);
  shape2d.lineTo(0, ridgeHeight);
  shape2d.lineTo(hd, 0);
  shape2d.lineTo(-hd, 0);
  const extrude = new THREE.ExtrudeGeometry(shape2d, { depth: ow, bevelEnabled: false, steps: 1 });
  extrude.rotateY(Math.PI / 2);
  extrude.translate(-hw, 0, 0);
  const mesh = new THREE.Mesh(extrude, roofMaterial(roof.material, roof.color));
  mesh.position.set(b.cx, baseY, b.cz);
  mesh.castShadow = true; mesh.receiveShadow = true;
  tagRoof(mesh, assembly);
  group.add(mesh);

  // Gable end walls (triangular infill under the two roof ends) in the
  // exterior facade material so the pitched ends read as finished walls.
  const gableMat = exteriorMaterial('plaster', roof.color);
  for (const side of [-1, 1]) {
    const gShape = new THREE.Shape();
    gShape.moveTo(-hd + roof.overhang, 0);
    gShape.lineTo(0, ridgeHeight);
    gShape.lineTo(hd - roof.overhang, 0);
    gShape.lineTo(-hd + roof.overhang, 0);
    const gGeo = new THREE.ShapeGeometry(gShape);
    const gMesh = new THREE.Mesh(gGeo, gableMat);
    gMesh.rotation.y = Math.PI / 2;
    gMesh.position.set(b.cx + side * (b.width / 2 - 0.02), baseY, b.cz);
    gMesh.userData.group = 'roof';
    group.add(gMesh);
  }

  // Ridge cap along the full ridge line.
  const ridgeCap = new THREE.Mesh(new THREE.BoxGeometry(ow, 0.08, 0.14), frameMaterial('aluminium', roof.color || '#7a5240'));
  ridgeCap.position.set(b.cx, baseY + ridgeHeight + 0.04, b.cz);
  tagRoof(ridgeCap, assembly);
  group.add(ridgeCap);

  // Eave gutter along the two long (eave) edges only — the gable ends
  // shed water off the triangular face, not into a gutter there.
  for (const zEdge of [b.minZ - roof.overhang, b.maxZ + roof.overhang]) {
    const seg = makeGutterSegment(ow);
    seg.position.set(b.cx, baseY - 0.1, zEdge);
    group.add(seg);
  }
  return group;
}

function buildMonoRoof(b, baseY, roof, assembly) {
  const group = new THREE.Group();
  const rise = Math.max(0.4, b.depth * Math.tan((roof.pitchDeg * Math.PI) / 180));
  const ow = b.width + roof.overhang * 2, od = b.depth + roof.overhang * 2;
  const geo = new THREE.PlaneGeometry(ow, Math.hypot(od, rise));
  const angle = Math.atan2(rise, od);
  geo.rotateX(-Math.PI / 2 + angle);
  const mesh = new THREE.Mesh(geo, roofMaterial(roof.material, roof.color));
  mesh.position.set(b.cx, baseY + rise / 2, b.cz);
  mesh.castShadow = true; mesh.receiveShadow = true;
  tagRoof(mesh, assembly);
  group.add(mesh);

  // Gutter along the LOW edge only — that's where a mono-pitch roof
  // actually sheds its water.
  const seg = makeGutterSegment(ow);
  seg.position.set(b.cx, baseY - 0.05, b.minZ - roof.overhang);
  group.add(seg);
  return group;
}
