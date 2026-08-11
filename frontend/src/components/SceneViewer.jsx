import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GROUP_LABELS, getShadowTexture, buildBuildingMeshes } from '../three/buildParts';
import PartInfoPanel from './PartInfoPanel';

// Renders an entire estate/compound: a ground plane sized to the site, a
// road grid between building plots, and every building's real hollow-wall
// geometry (same buildBuildingMeshes() used by the single-building editor)
// placed and rotated at its assigned site position. Each building is its
// own selectable/hideable group in the Scene Explorer sidebar — this is the
// "estate is not reduced to one house" requirement made concrete. In "Edit
// layout" mode, a whole building can be dragged to a new plot or spun in
// place with the same gizmo the single-building editor uses, constrained to
// the ground plane / vertical axis so a building can't be dragged into the
// air or tipped over.
export default function SceneViewer({ site, buildings, onFocusBuilding }) {
  const mountRef = useRef(null);
  const groupsRef = useRef([]);
  const meshesByBuildingRef = useRef({});
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const transformRef = useRef(null);
  const [buildError, setBuildError] = useState(null);
  const [hiddenIds, setHiddenIds] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [selectedInfo, setSelectedInfo] = useState(null);
  const [layoutEditMode, setLayoutEditMode] = useState(false);
  const [transformMode, setTransformMode] = useState('translate');
  const layoutEditModeRef = useRef(false);
  const transformModeRef = useRef('translate');
  const groupRootRef = useRef(null);

  const siteWidth = site?.width || 60;
  const siteDepth = site?.depth || 60;

  useEffect(() => { layoutEditModeRef.current = layoutEditMode; }, [layoutEditMode]);
  useEffect(() => {
    transformModeRef.current = transformMode;
    if (transformRef.current) {
      transformRef.current.setMode(transformMode);
      // A building may only slide across the ground plane, or spin around
      // the vertical axis — never lift off the ground or tip over.
      transformRef.current.showX = transformMode === 'translate';
      transformRef.current.showY = transformMode === 'rotate';
      transformRef.current.showZ = transformMode === 'translate';
    }
  }, [transformMode]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cleanup = () => {};
    try {
      const width = mount.clientWidth;
      const height = mount.clientHeight;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 800);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      mount.innerHTML = '';
      mount.appendChild(renderer.domElement);

      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.05).texture;
      pmremGenerator.dispose();

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controlsRef.current = controls;

      const key = new THREE.DirectionalLight(0xffffff, 1.3);
      key.position.set(20, 30, 15);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = -siteWidth;
      key.shadow.camera.right = siteWidth;
      key.shadow.camera.top = siteDepth;
      key.shadow.camera.bottom = -siteDepth;
      scene.add(key);
      scene.add(new THREE.DirectionalLight(0x88aacc, 0.25));
      scene.add(new THREE.AmbientLight(0x40454e, 0.55));

      // Site ground plane
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(siteWidth, siteDepth),
        new THREE.MeshStandardMaterial({ color: 0x2a3128, roughness: 1 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      const grid = new THREE.GridHelper(Math.max(siteWidth, siteDepth), 20, 0x40484f, 0x252b31);
      grid.position.y = 0.01;
      scene.add(grid);

      const root = new THREE.Group();
      groupRootRef.current = root;
      scene.add(root);

      const buildingGroups = [];
      meshesByBuildingRef.current = {};
      (buildings || []).forEach((b) => {
        const bGroup = new THREE.Group();
        const [x, z] = b.position || [0, 0];
        bGroup.position.set(x, 0, z);
        bGroup.rotation.y = b.rotation || 0;
        bGroup.userData.originalPosition = bGroup.position.clone();
        bGroup.userData.originalRotationY = bGroup.rotation.y;
        const meshes = buildBuildingMeshes(b.modelSpec?.parts || []);
        meshes.forEach(m => bGroup.add(m));
        bGroup.userData.buildingId = b.id;
        bGroup.userData.buildingName = b.name;
        root.add(bGroup);
        buildingGroups.push(bGroup);
        meshesByBuildingRef.current[b.id] = meshes;
      });
      groupsRef.current = buildingGroups;

      const box = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      if (!box.isEmpty()) { box.getSize(size); box.getCenter(center); }
      const maxDim = Math.max(size.x, size.z, siteWidth, siteDepth, 10);
      const dist = maxDim * 0.75;
      camera.position.set(center.x + dist * 0.6, dist * 0.55, center.z + dist * 0.7);
      camera.near = Math.max(maxDim / 500, 0.05);
      camera.far = maxDim * 20 + 200;
      camera.updateProjectionMatrix();
      controls.target.set(center.x, 0, center.z);
      controls.minDistance = maxDim * 0.05;
      controls.maxDistance = maxDim * 3;
      controls.update();

      const shadowDisc = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: getShadowTexture(), transparent: true, opacity: 0, depthWrite: false })
      );
      shadowDisc.visible = false;
      scene.add(shadowDisc);

      // Layout gizmo: drag a whole building to a new plot, or spin it in
      // place — same TransformControls the single-building editor uses,
      // attached to the building's Group instead of one of its meshes.
      const transformControls = new TransformControls(camera, renderer.domElement);
      transformControls.setMode(transformModeRef.current);
      transformControls.showX = transformModeRef.current === 'translate';
      transformControls.showY = transformModeRef.current === 'rotate';
      transformControls.showZ = transformModeRef.current === 'translate';
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
        if (transformControls.dragging) return;
        if (downPos) {
          const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
          if (moved > 6) return;
        }
        const rect = renderer.domElement.getBoundingClientRect();
        pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointerNdc, camera);
        const allMeshes = buildingGroups.flatMap(g => g.children);
        const hits = raycaster.intersectObjects(allMeshes, false);
        if (hits.length) {
          const target = hits[0].object;
          const parentGroup = target.parent;
          const label = GROUP_LABELS[target.userData.group] || target.userData.group;
          setActiveId(parentGroup.userData.buildingId);
          setSelectedInfo({
            label,
            group: target.userData.group,
            room: target.userData.room || null,
            floor: target.userData.floor ?? 1,
            material: target.userData.material || null,
            buildingName: parentGroup.userData.buildingName,
          });
          if (layoutEditModeRef.current) {
            transformControls.attach(parentGroup);
            transformControls.setMode(transformModeRef.current);
            transformControls.enabled = true;
            transformControls.visible = true;
          }
        } else {
          setSelectedInfo(null);
          transformControls.detach();
          transformControls.enabled = false;
          transformControls.visible = false;
        }
      };
      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointerup', onPointerUp);

      let frameId;
      const animate = () => {
        frameId = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      };
      animate();

      const handleResize = () => {
        const w = mount.clientWidth, h = mount.clientHeight;
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
        buildingGroups.forEach(g => g.children.forEach(m => { m.geometry?.dispose(); m.material?.dispose(); }));
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      };
    } catch (err) {
      console.error('SceneViewer failed to build the estate scene:', err);
      setBuildError(err.message || String(err));
    }
    return () => cleanup();
  }, [site, buildings]);

  useEffect(() => {
    groupsRef.current.forEach(g => {
      g.visible = !hiddenIds[g.userData.buildingId];
    });
  }, [hiddenIds]);

  useEffect(() => {
    if (!layoutEditMode && transformRef.current) {
      transformRef.current.detach();
      transformRef.current.enabled = false;
      transformRef.current.visible = false;
    }
  }, [layoutEditMode]);

  const resetLayout = () => {
    groupsRef.current.forEach(g => {
      if (g.userData.originalPosition) g.position.copy(g.userData.originalPosition);
      if (g.userData.originalRotationY != null) g.rotation.y = g.userData.originalRotationY;
    });
    if (transformRef.current) {
      transformRef.current.detach();
      transformRef.current.enabled = false;
      transformRef.current.visible = false;
    }
    setSelectedInfo(null);
  };

  const focusBuilding = (b) => {
    setActiveId(b.id);
    const group = groupsRef.current.find(g => g.userData.buildingId === b.id);
    const camera = cameraRef.current, controls = controlsRef.current;
    if (group && camera && controls) {
      const box = new THREE.Box3().setFromObject(group);
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z, 3);
      const dist = maxDim * 2;
      camera.position.set(center.x + dist * 0.6, center.y + dist * 0.5, center.z + dist * 0.7);
      controls.target.copy(center);
      controls.update();
    }
    if (onFocusBuilding) onFocusBuilding(b);
  };

  const exportGLB = () => {
    if (!groupRootRef.current) return;
    new GLTFExporter().parse(
      groupRootRef.current,
      (result) => {
        const blob = new Blob([result], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'estate.glb';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      (err) => console.error('Estate GLB export failed:', err),
      { binary: true }
    );
  };

  if (buildError) {
    return (
      <div className="viewer-shell" style={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ maxWidth: 420 }}>
          <p className="eyebrow">Estate scene couldn't render</p>
          <p className="page-sub" style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 12, wordBreak: 'break-word' }}>{buildError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="split-layout">
      <div className="split-main">
        <div className="viewer-shell">
          <span className="viewer-tag">Estate preview · drag to orbit · tap a building for details</span>
          {layoutEditMode && (
            <span className="viewer-hint">
              {selectedInfo ? `Editing: ${selectedInfo.buildingName} — drag to ${transformMode === 'rotate' ? 'spin' : 'reposition'}` : 'Tap any building to select it'}
            </span>
          )}
          <div className="viewer-canvas" ref={mountRef} style={{ height: 420 }} />
          <PartInfoPanel info={selectedInfo} onClose={() => setSelectedInfo(null)} />
          <div className="viewer-controls">
            {layoutEditMode && <button onClick={resetLayout}>Reset layout</button>}
            {layoutEditMode && (
              <>
                <button className={transformMode === 'translate' ? 'active' : ''} onClick={() => setTransformMode('translate')}>Move</button>
                <button className={transformMode === 'rotate' ? 'active' : ''} onClick={() => setTransformMode('rotate')}>Rotate</button>
              </>
            )}
            <button className={layoutEditMode ? 'active' : ''} onClick={() => setLayoutEditMode(v => !v)}>
              {layoutEditMode ? 'Done editing' : 'Edit layout'}
            </button>
            <button onClick={exportGLB} title="Download the whole estate as a .glb 3D file">Export estate .glb</button>
          </div>
        </div>
      </div>
      <div className="split-side">
        <div className="panel bracket">
          <div className="section-head"><h3>Scene Explorer</h3><span className="count">{(buildings || []).length} buildings</span></div>
          <div className="scene-explorer">
            {(buildings || []).map(b => (
              <div key={b.id} className={`scene-explorer-item${activeId === b.id ? ' active' : ''}`} onClick={() => focusBuilding(b)} role="button">
                <span className="name">{b.name}</span>
                <button
                  className={`toggle-visible${hiddenIds[b.id] ? ' hidden' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setHiddenIds(h => ({ ...h, [b.id]: !h[b.id] })); }}
                  title={hiddenIds[b.id] ? 'Show building' : 'Hide building'}
                >
                  {hiddenIds[b.id] ? 'Hidden' : 'Visible'}
                </button>
              </div>
            ))}
          </div>
          <p className="page-sub" style={{ marginTop: 12, fontSize: 12 }}>
            Site: {Math.round(siteWidth)}m × {Math.round(siteDepth)}m · {site?.cols || 1} × {site?.rows || 1} grid with road access between plots.
          </p>
        </div>
      </div>
    </div>
  );
}
