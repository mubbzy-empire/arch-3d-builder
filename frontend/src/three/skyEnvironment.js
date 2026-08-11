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
