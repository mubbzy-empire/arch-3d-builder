import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';

const MATERIAL_COLORS = { wood: 0xb98a55, metal: 0xaab2bd, glass: 0x8fd0e0, fabric: 0x6f6a63 };
const GROUP_LABELS = { structure: 'Walls', roof: 'Roof', door: 'Door', window: 'Windows', interior: 'Interior', furniture: 'Furniture' };

// ---------------------------------------------------------------------------
// Cheap procedural textures — generated once on a <canvas> and cached at
// module scope, reused across every mesh/mount instead of regenerating.
// ---------------------------------------------------------------------------
let woodTextureCache = null;
function getWoodTexture() {
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
function getFabricTexture() {
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
function getShadowTexture() {
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

function makeMaterial(materialName, colorHex) {
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

function buildMesh(part) {
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
  mesh.castShadow = !isGlass;
  mesh.receiveShadow = true;
  mesh.userData.group = part.group || 'structure';
  mesh.userData.originalPosition = mesh.position.clone();
  return mesh;
}

// ---------------------------------------------------------------------------
// Building shell: turns a single "structure" envelope box into real hollow
// walls with actual cut-through door/window openings, using CSG boolean
// operations — computed locally in the browser, no external service.
// ---------------------------------------------------------------------------
function buildHollowShell(structurePart, openingParts) {
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
    fillMesh.userData.originalPosition = fillMesh.position.clone();
    fillMeshes.push(fillMesh);
  }

  shellBrush.material = makeMaterial(structurePart.material || 'wood', structurePart.color);
  shellBrush.castShadow = true;
  shellBrush.receiveShadow = true;
  shellBrush.userData.group = 'structure';
  shellBrush.userData.originalPosition = shellBrush.position.clone();

  return { shellMesh: shellBrush, fillMeshes };
}

export default function ModelViewer({ modelSpec, title }) {
  const mountRef = useRef(null);
  const [wireframe, setWireframe] = useState(false);
  const [hideRoof, setHideRoof] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState(null);
  const [colorOverrides, setColorOverrides] = useState({});
  const [buildError, setBuildError] = useState(null);
  const [storyView, setStoryView] = useState(false);
  const meshesRef = useRef([]);
  const transformRef = useRef(null);
  const sceneRef = useRef(null);
  const groupRef = useRef(null);
  const editModeRef = useRef(false);

  const parts = modelSpec?.parts || [];
  const hasRoof = parts.some(p => p.group === 'roof');
  const presentGroups = useMemo(() => {
    const seen = new Set(parts.map(p => p.group || 'structure'));
    return ['structure', 'roof', 'door', 'window', 'interior', 'furniture'].filter(g => seen.has(g));
  }, [modelSpec]);
  const presentFloors = useMemo(() => {
    const seen = new Set(parts.filter(p => p.group === 'structure' || !p.group).map(p => p.floor ?? 1));
    return [...seen].sort((a, b) => a - b);
  }, [modelSpec]);

  useEffect(() => {
    setHideRoof(false);
    setColorOverrides({});
    setEditMode(false);
    setSelectedLabel(null);
    setBuildError(null);
    setStoryView(false);
  }, [modelSpec]);

  useEffect(() => { editModeRef.current = editMode; }, [editMode]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Everything below can throw (WebGL init, CSG boolean ops on unusual AI
    // output, etc). If it does, show a readable in-viewer error instead of
    // silently leaving a blank/broken canvas.
    let cleanup = () => {};
    try {
      const width = mount.clientWidth;
      const height = mount.clientHeight;

      const scene = new THREE.Scene();
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(38, width / height, 0.05, 100);
      camera.position.set(2.4, 1.8, 2.6);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      mount.innerHTML = '';
      mount.appendChild(renderer.domElement);

      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
      pmremGenerator.dispose();

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;

      const key = new THREE.DirectionalLight(0xffffff, 1.2);
      key.position.set(3, 5, 2);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.radius = 3;
      scene.add(key);
      const fill = new THREE.DirectionalLight(0x88aacc, 0.3);
      fill.position.set(-3, 2, -2);
      scene.add(fill);
      scene.add(new THREE.AmbientLight(0x404850, 0.5));

      const group = new THREE.Group();
      groupRef.current = group;
      const inputParts = parts.length ? parts : [{ type: 'box', size: [1, 1, 1], position: [0, 0.5, 0], material: 'wood', group: 'structure' }];

      const openingParts = inputParts.filter(p => p.group === 'door' || p.group === 'window');
      const structureParts = inputParts.filter(p => p.group === 'structure' || !p.group);
      const otherParts = inputParts.filter(p => p.group && p.group !== 'structure' && p.group !== 'door' && p.group !== 'window');

      // Multi-story support: each structure part may carry a "floor" number
      // (1 = ground floor, 2 = next up, etc). Every floor's envelope gets
      // its own independent hollow shell with its own matching door/window
      // openings — this makes each floor its own selectable, draggable part
      // in the viewer, so pulling one floor's walls away reveals the rest.
      const meshes = [];
      const floorNumbers = [...new Set(structureParts.map(p => p.floor ?? 1))].sort((a, b) => a - b);
      const isBuilding = openingParts.length > 0 && structureParts.length > 0;

      if (isBuilding) {
        floorNumbers.forEach(floorNum => {
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
        });
      } else {
        structureParts.forEach(p => {
          const m = buildMesh(p);
          m.userData.floor = p.floor ?? 1;
          meshes.push(m);
        });
      }
      otherParts.forEach(p => {
        const m = buildMesh(p);
        m.userData.floor = p.floor ?? 1;
        m.userData.room = p.room || null;
        meshes.push(m);
      });

      meshes.forEach(m => group.add(m));
      meshesRef.current = meshes;
      scene.add(group);

      const box = new THREE.Box3().setFromObject(group);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const maxDim = Math.max(size.x, size.y, size.z, 0.2);
      const radius = maxDim / 2;

      camera.near = Math.max(radius / 500, 0.01);
      camera.far = radius * 60 + 100;
      camera.updateProjectionMatrix();

      const dist = radius * 2.6;
      camera.position.set(center.x + dist * 0.65, center.y + dist * 0.5, center.z + dist * 0.7);
      controls.target.copy(center);
      controls.minDistance = radius * 0.25;
      controls.maxDistance = radius * 6;
      controls.update();

      const gridSize = Math.max(maxDim * 2.5, 4);
      const grid = new THREE.GridHelper(gridSize, 24, 0x3a4048, 0x1c2027);
      grid.position.y = box.min.y;
      scene.add(grid);

      const shadowDisc = new THREE.Mesh(
        new THREE.PlaneGeometry(maxDim * 1.6, maxDim * 1.6),
        new THREE.MeshBasicMaterial({ map: getShadowTexture(), transparent: true, depthWrite: false })
      );
      shadowDisc.rotation.x = -Math.PI / 2;
      shadowDisc.position.set(center.x, box.min.y + 0.002, center.z);
      scene.add(shadowDisc);

      // Click-to-select + drag gizmo (edit mode only), Blender-style.
      const transformControls = new TransformControls(camera, renderer.domElement);
      transformControls.setMode('translate');
      transformControls.setSize(0.9);
      transformControls.enabled = false;
      transformControls.visible = false;
      const gizmoHelper = transformControls.getHelper ? transformControls.getHelper() : transformControls;
      scene.add(gizmoHelper);
      transformRef.current = transformControls;

      transformControls.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; });

      const raycaster = new THREE.Raycaster();
      const pointerNdc = new THREE.Vector2();
      let downPos = null;

      const onPointerDown = (e) => { downPos = { x: e.clientX, y: e.clientY }; };
      const onPointerUp = (e) => {
        if (!editModeRef.current || transformControls.dragging) return;
        if (downPos) {
          const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
          if (moved > 6) return; // was an orbit drag, not a click
        }
        const rect = renderer.domElement.getBoundingClientRect();
        pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObjects(meshesRef.current, false);
        if (hits.length) {
          const target = hits[0].object;
          transformControls.attach(target);
          transformControls.enabled = true;
          transformControls.visible = true;
          setSelectedLabel(GROUP_LABELS[target.userData.group] || target.userData.group);
        } else {
          transformControls.detach();
          transformControls.enabled = false;
          transformControls.visible = false;
          setSelectedLabel(null);
        }
      };
      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointerup', onPointerUp);

      let frameId;
      const animate = () => {
        frameId = requestAnimationFrame(animate);
        if (!transformControls.dragging) group.rotation.y += editModeRef.current ? 0 : 0.0025;
        controls.update();
        renderer.render(scene, camera);
      };
      animate();

      const handleResize = () => {
        const w = mount.clientWidth;
        const h = mount.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', handleResize);

      cleanup = () => {
        cancelAnimationFrame(frameId);
        window.removeEventListener('resize', handleResize);
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('pointerup', onPointerUp);
        transformControls.dispose();
        controls.dispose();
        renderer.dispose();
        scene.environment?.dispose?.();
        shadowDisc.geometry.dispose();
        shadowDisc.material.dispose();
        meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      };
    } catch (err) {
      console.error('ModelViewer failed to build the 3D scene:', err);
      setBuildError(err.message || String(err));
    }

    return () => cleanup();
  }, [modelSpec]);

  useEffect(() => {
    meshesRef.current.forEach(m => { m.material.wireframe = wireframe; });
  }, [wireframe]);

  useEffect(() => {
    meshesRef.current.forEach(m => { if (m.userData.group === 'roof') m.visible = !hideRoof; });
  }, [hideRoof, modelSpec]);

  useEffect(() => {
    meshesRef.current.forEach(m => {
      const override = colorOverrides[m.userData.group];
      if (override) m.material.color.set(override);
    });
  }, [colorOverrides, modelSpec]);

  useEffect(() => {
    if (!editMode && transformRef.current) {
      transformRef.current.detach();
      transformRef.current.enabled = false;
      transformRef.current.visible = false;
      setSelectedLabel(null);
    }
  }, [editMode]);

  const resetPositions = () => {
    meshesRef.current.forEach(m => {
      if (m.userData.originalPosition) m.position.copy(m.userData.originalPosition);
    });
    if (transformRef.current) {
      transformRef.current.detach();
      transformRef.current.enabled = false;
      transformRef.current.visible = false;
    }
    setSelectedLabel(null);
    setStoryView(false);
  };

  const toggleStoryView = () => {
    const GAP = 1.6; // meters of extra vertical separation per floor above ground
    const next = !storyView;
    meshesRef.current.forEach(m => {
      const floor = m.userData.floor ?? 1;
      const delta = (floor - 1) * GAP;
      if (delta === 0) return;
      m.position.y += next ? delta : -delta;
    });
    setStoryView(next);
  };

  const exportGLB = () => {
    if (!groupRef.current) return;
    const filename = `${(title || 'archvision-model').toString().replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.glb`;
    new GLTFExporter().parse(
      groupRef.current,
      (result) => {
        const blob = new Blob([result], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      (err) => console.error('GLB export failed:', err),
      { binary: true }
    );
  };

  if (buildError) {
    return (
      <div className="viewer-shell" style={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ maxWidth: 420 }}>
          <p className="eyebrow">3D preview couldn't render</p>
          <p className="page-sub" style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 12, wordBreak: 'break-word' }}>
            {buildError}
          </p>
          <p className="page-sub" style={{ marginTop: 10 }}>
            Screenshot this message and send it back — the rest of the design details below are unaffected.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="viewer-shell">
      <span className="viewer-tag">3D preview · drag to orbit</span>
      {editMode && (
        <span className="viewer-hint">{selectedLabel ? `Editing: ${selectedLabel} — drag an arrow` : 'Tap a part to select it'}</span>
      )}
      <div className="viewer-canvas" ref={mountRef} />
      <div className="viewer-controls">
        {editMode && <button onClick={resetPositions}>Reset positions</button>}
        <button className={editMode ? 'active' : ''} onClick={() => setEditMode(v => !v)}>
          {editMode ? 'Done editing' : 'Edit parts'}
        </button>
        {hasRoof && (
          <button className={hideRoof ? 'active' : ''} onClick={() => setHideRoof(v => !v)}>
            {hideRoof ? 'Show roof' : 'Interior view'}
          </button>
        )}
        {presentFloors.length > 1 && (
          <button className={storyView ? 'active' : ''} onClick={toggleStoryView}>
            {storyView ? 'Stack floors' : 'Separate floors'}
          </button>
        )}
        <button className={!wireframe ? 'active' : ''} onClick={() => setWireframe(false)}>Solid</button>
        <button className={wireframe ? 'active' : ''} onClick={() => setWireframe(true)}>Wireframe</button>
        <button onClick={exportGLB} title="Download as a .glb 3D file — opens in Blender and most 3D software">Export .glb</button>
      </div>
      {presentGroups.length > 0 && (
        <div className="color-row">
          {presentGroups.map(g => (
            <label key={g} className="color-swatch" title={`Recolor ${GROUP_LABELS[g] || g}`}>
              <input type="color" value={colorOverrides[g] || '#c9a26a'} onChange={e => setColorOverrides(o => ({ ...o, [g]: e.target.value }))} />
              <span>{GROUP_LABELS[g] || g}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
