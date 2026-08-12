import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Outdoor daylight rendering context — sky backdrop, sun + sky-bounce
// lighting, and a grass/paving ground. This is intentionally separate from
// buildParts.js: nothing here touches part geometry, materials, or the
// manual modeler's data model. It only changes what a scene looks like it's
// sitting in, the same way swapping a render's HDRI backdrop would.
// ---------------------------------------------------------------------------

let skyTextureCache = null;
export function getSkyTexture() {
  if (skyTextureCache) return skyTextureCache;
  const w = 512, h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#4d7dc4');
  grad.addColorStop(0.32, '#9fc2e6');
  grad.addColorStop(0.6, '#d9e8f0');
  grad.addColorStop(1, '#f2efe4');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  for (let i = 0; i < 16; i++) {
    const cx = Math.random() * w;
    const cy = h * 0.12 + Math.random() * h * 0.38;
    const rx = 35 + Math.random() * 75;
    const ry = rx * (0.28 + Math.random() * 0.12);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  skyTextureCache = texture;
  return texture;
}

// Sets the visible backdrop + atmospheric fog. Does not touch
// scene.environment (the PBR reflection probe), so glass/metal reflections
// set up elsewhere are unaffected.
export function applySkyBackground(scene, { near = 40, far = 260, color = 0xcfe0ee } = {}) {
  scene.background = getSkyTexture();
  scene.fog = new THREE.Fog(color, near, far);
}

let pavingTextureCache = null;
function getPavingTexture() {
  if (pavingTextureCache) return pavingTextureCache;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#9a988f';
  ctx.fillRect(0, 0, size, size);
  const cell = 22;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const shade = 0.82 + Math.random() * 0.3;
      ctx.fillStyle = `rgba(${Math.round(150 * shade)},${Math.round(147 * shade)},${Math.round(138 * shade)},1)`;
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  pavingTextureCache = texture;
  return texture;
}

let grassTextureCache = null;
function getGrassTexture() {
  if (grassTextureCache) return grassTextureCache;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3f8f44';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 700; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const shade = 0.65 + Math.random() * 0.55;
    ctx.strokeStyle = `rgba(${Math.round(35 * shade)},${Math.round(115 * shade)},${Math.round(48 * shade)},0.55)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 3, y - 3 - Math.random() * 3);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  grassTextureCache = texture;
  return texture;
}

// A grass field with a paved apron in the middle (yard/driveway), sized to
// width/depth. Returns a Group; both meshes cast no shadow but receive them.
export function buildOutdoorGround(width, depth) {
  const group = new THREE.Group();

  const grassTex = getGrassTexture().clone();
  grassTex.needsUpdate = true;
  grassTex.repeat.set(Math.max(1, width / 2), Math.max(1, depth / 2));
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  group.add(grass);

  const paveW = width * 0.6, paveD = depth * 0.6;
  const paveTex = getPavingTexture().clone();
  paveTex.needsUpdate = true;
  paveTex.repeat.set(Math.max(1, paveW / 2), Math.max(1, paveD / 2));
  const pave = new THREE.Mesh(
    new THREE.PlaneGeometry(paveW, paveD),
    new THREE.MeshStandardMaterial({ map: paveTex, roughness: 0.95 })
  );
  pave.rotation.x = -Math.PI / 2;
  pave.position.y = 0.004;
  pave.receiveShadow = true;
  group.add(pave);

  return group;
}

// ---------------------------------------------------------------------------
// Compound wall: a perimeter wall with corner pillars, a two-leaf bar gate on
// one side, and a coping cap — what turns a lone building sitting on open
// grass into a proper walled "compound". Used by both the single-building
// viewer and the estate scene so every generated model (bungalow, storey
// building, or estate) gets the same finished site treatment. `gateSide`
// picks which side of the plot gets the vehicle entrance — default "front"
// lines it up with the paved apron buildOutdoorGround() already draws.
// ---------------------------------------------------------------------------
export function buildCompoundWall(width, depth, {
  wallHeight = 1.5, gateWidth = 3.6, gateSide = 'front',
  wallColor = '#3f4550', capColor = '#e8e4d8', pillarColor = '#2f333c', barColor = '#20232a',
} = {}) {
  const group = new THREE.Group();
  const wallT = 0.18;
  const pillarSize = 0.34;
  const halfW = width / 2, halfD = depth / 2;

  const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.85, metalness: 0.05 });
  const capMat = new THREE.MeshStandardMaterial({ color: capColor, roughness: 0.6, metalness: 0.1 });
  const pillarMat = new THREE.MeshStandardMaterial({ color: pillarColor, roughness: 0.75, metalness: 0.08 });
  const barMat = new THREE.MeshStandardMaterial({ color: barColor, roughness: 0.4, metalness: 0.6 });
  const tag = (o) => { o.userData.group = 'compound'; o.userData.room = null; o.castShadow = true; o.receiveShadow = true; return o; };

  const addSegment = (cx, cz, length, rotY) => {
    if (length <= 0.05) return;
    const wall = tag(new THREE.Mesh(new THREE.BoxGeometry(length, wallHeight, wallT), wallMat));
    wall.position.set(cx, wallHeight / 2, cz);
    wall.rotation.y = rotY;
    group.add(wall);
    const cap = tag(new THREE.Mesh(new THREE.BoxGeometry(length + 0.04, 0.06, wallT + 0.06), capMat));
    cap.position.set(cx, wallHeight + 0.03, cz);
    cap.rotation.y = rotY;
    group.add(cap);
  };

  const addPillar = (cx, cz, h = wallHeight + 0.28) => {
    const pillar = tag(new THREE.Mesh(new THREE.BoxGeometry(pillarSize, h, pillarSize), pillarMat));
    pillar.position.set(cx, h / 2, cz);
    group.add(pillar);
    const cap = tag(new THREE.Mesh(new THREE.BoxGeometry(pillarSize + 0.08, 0.08, pillarSize + 0.08), capMat));
    cap.position.set(cx, h + 0.04, cz);
    group.add(cap);
  };

  const addGateLeaf = (hingeX, fixedCoord, leafW, isZ, dir) => {
    const leaf = new THREE.Group();
    const barCount = Math.max(5, Math.round(leafW / 0.18));
    const leafH = wallHeight * 0.86;
    for (let i = 0; i <= barCount; i++) {
      const bx = -leafW / 2 + (leafW * i) / barCount;
      const bar = tag(new THREE.Mesh(new THREE.BoxGeometry(0.035, leafH, 0.035), barMat));
      bar.position.set(bx, leafH / 2, 0);
      leaf.add(bar);
    }
    [leafH, 0.06].forEach(y => {
      const rail = tag(new THREE.Mesh(new THREE.BoxGeometry(leafW, 0.05, 0.05), barMat));
      rail.position.set(0, y, 0);
      leaf.add(rail);
    });
    const openAngle = dir < 0 ? -0.3 : 0.3;
    if (isZ) {
      leaf.position.set(hingeX, 0, fixedCoord);
      leaf.rotation.y = openAngle;
    } else {
      leaf.position.set(fixedCoord, 0, hingeX);
      leaf.rotation.y = Math.PI / 2 + openAngle;
    }
    group.add(leaf);
  };

  const sides = [
    { key: 'front', isZ: true, fixed: halfD },
    { key: 'back', isZ: true, fixed: -halfD },
    { key: 'left', isZ: false, fixed: -halfW },
    { key: 'right', isZ: false, fixed: halfW },
  ];

  sides.forEach(side => {
    const runLength = side.isZ ? width : depth;
    const rotY = side.isZ ? 0 : Math.PI / 2;
    const half = runLength / 2;

    if (side.key !== gateSide) {
      addSegment(side.isZ ? 0 : side.fixed, side.isZ ? side.fixed : 0, runLength, rotY);
      return;
    }
    const gw = Math.min(gateWidth, runLength * 0.7);
    const gp = gw / 2;
    const seg = half - gp;
    const off = (half + gp) / 2;
    if (side.isZ) {
      addSegment(-off, side.fixed, seg, rotY);
      addSegment(off, side.fixed, seg, rotY);
      addPillar(-gp, side.fixed, wallHeight + 0.5);
      addPillar(gp, side.fixed, wallHeight + 0.5);
      addGateLeaf(-gp, side.fixed, gp - 0.06, true, -1);
      addGateLeaf(gp, side.fixed, gp - 0.06, true, 1);
    } else {
      addSegment(side.fixed, -off, seg, rotY);
      addSegment(side.fixed, off, seg, rotY);
      addPillar(side.fixed, -gp, wallHeight + 0.5);
      addPillar(side.fixed, gp, wallHeight + 0.5);
      addGateLeaf(-gp, side.fixed, gp - 0.06, false, -1);
      addGateLeaf(gp, side.fixed, gp - 0.06, false, 1);
    }
  });

  [[-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD]].forEach(([x, z]) => addPillar(x, z));

  group.userData.group = 'compound';
  return group;
}

// Warm sun + sky/ground-bounce ambient, replacing a flat single ambient
// light with something that reads as a bright but soft daylight photo.
// `span` should roughly match the scene's footprint so the sun's shadow
// camera frustum covers everything that needs to cast a shadow.
export function addDaylight(scene, { sunIntensity = 1.35, span = 20 } = {}) {
  const sun = new THREE.DirectionalLight(0xfff3df, sunIntensity);
  sun.position.set(span * 0.55, span * 0.85, span * 0.45);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -span;
  sun.shadow.camera.right = span;
  sun.shadow.camera.top = span;
  sun.shadow.camera.bottom = -span;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(0xbfd9f2, 0x4a5a3c, 0.8);
  scene.add(hemi);

  return { sun, hemi };
}
