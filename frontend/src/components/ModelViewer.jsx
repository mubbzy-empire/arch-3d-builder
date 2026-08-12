import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GROUP_LABELS, getShadowTexture, buildBuildingMeshes, buildManualMeshes } from '../three/buildParts';
import { applySkyBackground, buildOutdoorGround, addDaylight, buildCompoundWall } from '../three/skyEnvironment';
import PartInfoPanel from './PartInfoPanel';

export default function ModelViewer({ modelSpec, title }) {
  const mountRef = useRef(null);
  const [wireframe, setWireframe] = useState(false);
  const [hideRoof, setHideRoof] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [transformMode, setTransformMode] = useState('translate');
  const [selectedLabel, setSelectedLabel] = useState(null);
  const [selectedInfo, setSelectedInfo] = useState(null);
  const [colorOverrides, setColorOverrides] = useState({});
  const [buildError, setBuildError] = useState(null);
  const [storyView, setStoryView] = useState(false);
  // The WebGL scene is expensive to build (geometry, textures, shadow maps)
  // and isn't needed until the person actually wants to look at it — so we
  // don't touch Three.js at all until they tap "View 3D model".
  const [started, setStarted] = useState(false);
  const meshesRef = useRef([]);
  const transformRef = useRef(null);
  const sceneRef = useRef(null);
  const groupRef = useRef(null);
  const editModeRef = useRef(false);
  const transformModeRef = useRef('translate');
  const interiorFillRef = useRef(null);
  const gridRef = useRef(null);

  const parts = modelSpec?.parts || [];
  const hasRoof = parts.some(p => p.group === 'roof');
  const presentGroups = useMemo(() => {
    const seen = new Set(parts.map(p => p.group || 'structure'));
    return ['structure', 'roof', 'door', 'window', 'interior', 'interior-door', 'balcony'].filter(g => seen.has(g));
  }, [modelSpec]);
  const presentFloors = useMemo(() => {
    const seen = new Set(parts.filter(p => p.group === 'structure' || !p.group).map(p => p.floor ?? 1));
    return [...seen].sort((a, b) => a - b);
  }, [modelSpec]);

  useEffect(() => {
    setHideRoof(false);
    setColorOverrides({});
    setEditMode(false);
    setTransformMode('translate');
    setSelectedLabel(null);
    setSelectedInfo(null);
    setBuildError(null);
    setStoryView(false);
    setStarted(false);
  }, [modelSpec]);

  useEffect(() => { editModeRef.current = editMode; }, [editMode]);
  useEffect(() => {
    transformModeRef.current = transformMode;
    if (transformRef.current) transformRef.current.setMode(transformMode);
  }, [transformMode]);

  useEffect(() => {
    if (!started) return;
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

      const group = new THREE.Group();
      groupRef.current = group;
      const inputParts = parts.length ? parts : [{ type: 'box', size: [1, 1, 1], position: [0, 0.5, 0], material: 'wood', group: 'structure' }];

      // Multi-story support: each structure part may carry a "floor" number
      // (1 = ground floor, 2 = next up, etc). Every floor's envelope gets
      // its own independent hollow shell with its own matching door/window
      // openings — this makes each floor its own selectable, draggable part
      // in the viewer, so pulling one floor's walls away reveals the rest.
      //
      // A "manual" scene (built wall-by-wall in the from-scratch modeler)
      // carries its own per-wall openings via each opening's `wallId`
      // rather than one whole-building envelope — detect and branch to the
      // matching builder so each wall only gets its own doors/windows cut
      // into it, not every opening in the scene.
      const isManualScene = inputParts.some(p => p.wallId);
      const meshes = isManualScene ? buildManualMeshes(inputParts).meshes : buildBuildingMeshes(inputParts);

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

      // Outdoor daylight rendering context — sky backdrop, sun + sky-bounce
      // light, and a grass/paving ground sized to this model, so a single
      // building preview reads as a real outdoor photo instead of a part
      // floating in a void. Purely presentational: no part geometry or
      // material tables (buildParts.js) are touched.
      applySkyBackground(scene, { near: Math.max(radius * 3, 4), far: Math.max(radius * 24, 60) });
      addDaylight(scene, { span: Math.max(radius * 2.5, 6) });
      const ground = buildOutdoorGround(Math.max(radius * 10, 12), Math.max(radius * 10, 12));
      ground.position.set(center.x, box.min.y - 0.001, center.z);
      scene.add(ground);

      // Compound wall: a perimeter wall + gate around the plot, sized to
      // give the building a real yard inside it (not the whole grass field
      // the ground plane covers) — the same walled-compound treatment the
      // estate scene uses, now applied to every single-building model too.
      // Kept close to the building (not the old radius*4.4) specifically so
      // it sits inside the camera's default framing below instead of
      // requiring the person to zoom/pan out to ever see it.
      const compoundSpan = Math.max(maxDim * 1.45, 9);
      const compound = buildCompoundWall(compoundSpan, compoundSpan, { gateWidth: Math.min(4, compoundSpan * 0.4) });
      compound.position.set(center.x, box.min.y, center.z);
      scene.add(compound);

      // Soft interior fill light: off while the roof is on, brought up when
      // "Show interior" is toggled so rooms read clearly instead of relying
      // on the sun alone (which can leave far walls dark once the roof is
      // gone). Toggled in the hideRoof effect below.
      // Physically-correct lighting (the default since three.js r155+) means
      // point-light intensity is in candela, where small values like the
      // "1.2" this used to be are effectively invisible — that's why the
      // interior looked almost unlit/black once the roof came off. Decay=1
      // (linear falloff) plus a much higher on-intensity below actually
      // lights a room-scale interior.
      const interiorFill = new THREE.PointLight(0xfff1d6, 0, Math.max(radius * 6, 10), 1);
      interiorFill.position.set(center.x, center.y + Math.max(radius * 1.4, 2), center.z);
      scene.add(interiorFill);
      interiorFillRef.current = interiorFill;

      camera.near = Math.max(radius / 500, 0.01);
      camera.far = radius * 60 + 100;
      camera.updateProjectionMatrix();

      // Framed wide enough to include the compound wall by default (not
      // just the bare building), so the wall/gate are visible on first
      // load instead of only after zooming out.
      const dist = Math.max(radius * 2.6, compoundSpan * 0.95);
      camera.position.set(center.x + dist * 0.65, center.y + dist * 0.5, center.z + dist * 0.7);
      controls.target.copy(center);
      controls.minDistance = radius * 0.25;
      controls.maxDistance = radius * 6;
      controls.update();

      const gridSize = Math.max(maxDim * 2.5, 4);
      const grid = new THREE.GridHelper(gridSize, 24, 0x3a4048, 0x1c2027);
      grid.position.y = box.min.y + 0.002;
      grid.visible = editModeRef.current;
      scene.add(grid);
      gridRef.current = grid;

      const shadowDisc = new THREE.Mesh(
        new THREE.PlaneGeometry(maxDim * 1.6, maxDim * 1.6),
        new THREE.MeshBasicMaterial({ map: getShadowTexture(), transparent: true, depthWrite: false })
      );
      shadowDisc.rotation.x = -Math.PI / 2;
      shadowDisc.position.set(center.x, box.min.y + 0.002, center.z);
      scene.add(shadowDisc);

      // Click-to-select + drag/rotate gizmo (edit mode only), Blender-style.
      const transformControls = new TransformControls(camera, renderer.domElement);
      transformControls.setMode(transformModeRef.current);
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
          if (moved > 6) return; // was an orbit drag, not a click
        }
        const rect = renderer.domElement.getBoundingClientRect();
        pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObjects(meshesRef.current, false);
        if (hits.length) {
          const target = hits[0].object;
          const label = GROUP_LABELS[target.userData.group] || target.userData.group;
          setSelectedLabel(label);
          setSelectedInfo({
            label,
            group: target.userData.group,
            room: target.userData.room || null,
            floor: target.userData.floor ?? 1,
            material: target.userData.material || null,
          });
          if (editModeRef.current) {
            transformControls.attach(target);
            transformControls.setMode(transformModeRef.current);
            transformControls.enabled = true;
            transformControls.visible = true;
          }
        } else {
          transformControls.detach();
          transformControls.enabled = false;
          transformControls.visible = false;
          setSelectedLabel(null);
          setSelectedInfo(null);
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
        ground.children.forEach(m => { m.geometry?.dispose(); m.material?.dispose(); });
        compound.traverse(m => { m.geometry?.dispose(); m.material?.dispose(); });
        meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      };
    } catch (err) {
      console.error('ModelViewer failed to build the 3D scene:', err);
      setBuildError(err.message || String(err));
    }

    return () => cleanup();
  }, [modelSpec, started]);

  useEffect(() => {
    meshesRef.current.forEach(m => { m.material.wireframe = wireframe; });
  }, [wireframe]);

  useEffect(() => {
    meshesRef.current.forEach(m => { if (m.userData.group === 'roof') m.visible = !hideRoof; });
    // Was "1.2", which is essentially invisible under physically-correct
    // (candela) point-light units — that's the direct cause of the very
    // dark/black interior floor in the "Show interior" screenshots.
    if (interiorFillRef.current) interiorFillRef.current.intensity = hideRoof ? 90 : 0;
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
    }
    if (gridRef.current) gridRef.current.visible = editMode;
  }, [editMode]);

  const resetPositions = () => {
    meshesRef.current.forEach(m => {
      if (m.userData.originalPosition) m.position.copy(m.userData.originalPosition);
      if (m.userData.originalRotationY != null) m.rotation.y = m.userData.originalRotationY;
    });
    if (transformRef.current) {
      transformRef.current.detach();
      transformRef.current.enabled = false;
      transformRef.current.visible = false;
    }
    setSelectedLabel(null);
    setSelectedInfo(null);
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

  if (!started) {
    return (
      <div className="viewer-shell">
        <div className="viewer-launcher">
          <span className="viewer-launcher-icon" />
          <p className="page-sub">
            The 3D model {hasRoof ? 'loads with the roof on — reveal the interior any time with the button below.' : 'is ready to load.'}
          </p>
          <button className="btn btn-primary" onClick={() => setStarted(true)}>View 3D model</button>
        </div>
      </div>
    );
  }

  return (
    <div className="viewer-shell">
      <span className="viewer-tag">3D preview · drag to orbit · tap a part for details</span>
      {editMode && (
        <span className="viewer-hint">{selectedLabel ? `Editing: ${selectedLabel} — drag to ${transformMode === 'rotate' ? 'rotate' : 'move'}` : 'Tap a part to select it'}</span>
      )}
      <div className="viewer-canvas" ref={mountRef} />
      <PartInfoPanel info={selectedInfo} onClose={() => setSelectedInfo(null)} />
      <div className="viewer-controls">
        {editMode && <button onClick={resetPositions}>Reset positions</button>}
        {editMode && (
          <>
            <button className={transformMode === 'translate' ? 'active' : ''} onClick={() => setTransformMode('translate')}>Move</button>
            <button className={transformMode === 'rotate' ? 'active' : ''} onClick={() => setTransformMode('rotate')}>Rotate</button>
          </>
        )}
        <button className={editMode ? 'active' : ''} onClick={() => setEditMode(v => !v)}>
          {editMode ? 'Done editing' : 'Edit parts'}
        </button>
        {hasRoof && (
          <button className={hideRoof ? 'active' : ''} onClick={() => setHideRoof(v => !v)}>
            {hideRoof ? 'Hide interior' : 'Show interior'}
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
