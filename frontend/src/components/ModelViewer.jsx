import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GROUP_LABELS, getShadowTexture, buildBuildingMeshes, buildManualMeshes } from '../three/buildParts';
import { applySkyBackground, buildOutdoorGround, addDaylight, buildCompoundWall } from '../three/skyEnvironment';
import { buildBuildingGroup, generateBuildingFromBrief } from '../three/architecture';
import PartInfoPanel from './PartInfoPanel';

// Phase 1 sample briefs for the new architectural engine — lets you compare
// the new engine against the legacy box pipeline right now, from the
// viewer itself, before the AI routes are wired to produce `modelSpec.building`
// (that's Phase 2: aiService.js prompt/schema redesign).
const ARCHITECTURE_DEMO_BRIEFS = {
  bungalow: { name: '3-Bedroom Bungalow', floors: 1, footprint: { width: 12, depth: 9 }, bedrooms: 3, roofType: 'hip', style: 'traditional', features: { porch: true, compoundWall: true, gate: true } },
  duplex: { name: '4-Bedroom Modern Duplex', floors: 2, footprint: { width: 12, depth: 10 }, setbackPerFloor: [{ width: 10.5, depth: 9 }], bedrooms: 4, roofType: 'flat', style: 'modern', features: { garage: true, compoundWall: true, gate: true } },
  threeStorey: { name: '3-Storey Modern House', floors: 3, footprint: { width: 13, depth: 10.5 }, setbackPerFloor: [{ width: 11.5, depth: 9.5 }, { width: 10, depth: 8.5 }], bedrooms: 5, roofType: 'flat', style: 'modern', features: { garage: true } },
};

export default function ModelViewer({ modelSpec, title }) {
  const mountRef = useRef(null);
  const [wireframe, setWireframe] = useState(false);
  const [hideRoof, setHideRoof] = useState(false);
  const [showMep, setShowMep] = useState(false); // MEP layer is off by default — see mepSystem.js
  const [editMode, setEditMode] = useState(false);
  const [transformMode, setTransformMode] = useState('translate');
  const [selectedLabel, setSelectedLabel] = useState(null);
  const [dragIsWholeWall, setDragIsWholeWall] = useState(false);
  const [selectedInfo, setSelectedInfo] = useState(null);
  const [colorOverrides, setColorOverrides] = useState({});
  const [buildError, setBuildError] = useState(null);
  const [storyView, setStoryView] = useState(false);
  // The WebGL scene is expensive to build (geometry, textures, shadow maps)
  // and isn't needed until the person actually wants to look at it — so we
  // don't touch Three.js at all until they tap "View 3D model".
  const [started, setStarted] = useState(false);
  const meshesRef = useRef([]);
  // Populated alongside meshesRef by the same archGroup.traverse below —
  // MEP conduit runs are built as THREE.Line (dashed, to read as
  // schematic wiring rather than a physical pipe — see mepSystem.js), and
  // Line objects are NOT THREE.Mesh, so they were invisible to every
  // existing mesh-only traversal in this file. Without this, the MEP
  // toggle below would correctly hide every device box/pipe mesh but
  // leave every conduit line permanently on screen, with no way to
  // hide them — a real bug, not a hypothetical one, caught while wiring
  // this up rather than after.
  const linesRef = useRef([]);
  const groupsRef = useRef([]);
  const transformRef = useRef(null);
  const sceneRef = useRef(null);
  const groupRef = useRef(null);
  const editModeRef = useRef(false);
  const transformModeRef = useRef('translate');
  const interiorFillRef = useRef(null);
  const gridRef = useRef(null);
  // Set by the "New engine demo" buttons below — takes priority over
  // modelSpec so you can A/B the two pipelines on demand. Once a route
  // starts sending modelSpec.building (Phase 2+), that flows through the
  // same architecturalBuilding variable with no further changes here.
  const [demoBuilding, setDemoBuilding] = useState(null);
  // Phase 2: Chat -> 3D now sends modelSpec.designBrief (what the building
  // is) instead of modelSpec.parts (raw box coordinates) for residential
  // requests. generateBuildingFromBrief is the same deterministic
  // space-planning engine the demo buttons above use — one engine behind
  // both paths, per the rebuild spec. Memoized so it's only recomputed
  // when the brief itself actually changes, not on every render.
  const briefBuilding = useMemo(() => (
    modelSpec?.designBrief ? generateBuildingFromBrief(modelSpec.designBrief) : null
  ), [modelSpec]);
  const architecturalBuilding = demoBuilding || modelSpec?.building || briefBuilding || null;

  const parts = modelSpec?.parts || [];
  const hasRoof = architecturalBuilding ? true : parts.some(p => p.group === 'roof');
  const presentGroups = useMemo(() => {
    if (architecturalBuilding) return ['structure', 'roof', 'door', 'window', 'interior', 'stair'];
    const seen = new Set(parts.map(p => p.group || 'structure'));
    return ['structure', 'roof', 'door', 'window', 'interior', 'interior-door', 'balcony'].filter(g => seen.has(g));
  }, [modelSpec, architecturalBuilding]);
  const presentFloors = useMemo(() => {
    if (architecturalBuilding) return architecturalBuilding.levels.map(l => l.index);
    const seen = new Set(parts.filter(p => p.group === 'structure' || !p.group).map(p => p.floor ?? 1));
    return [...seen].sort((a, b) => a - b);
  }, [modelSpec, architecturalBuilding]);

  useEffect(() => {
    setHideRoof(false);
    setShowMep(false);
    setColorOverrides({});
    setEditMode(false);
    setTransformMode('translate');
    setSelectedLabel(null);
          setDragIsWholeWall(false);
    setSelectedInfo(null);
    setBuildError(null);
    setStoryView(false);
    setStarted(false);
    setDemoBuilding(null);
  }, [modelSpec]);

  const runArchitectureDemo = (key) => {
    setDemoBuilding(generateBuildingFromBrief(ARCHITECTURE_DEMO_BRIEFS[key]));
    setBuildError(null);
    setStarted(true);
  };

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

      let meshes;
      if (architecturalBuilding) {
        // New architectural engine (Phase 1): a real Building IR — levels,
        // wall segments, room-attached openings, roof from the top
        // footprint — rather than a flat box list. buildBuildingGroup
        // already returns a ready-to-add THREE.Group; we flatten its
        // meshes into meshesRef so recolor/wireframe/story-view/edit-mode
        // controls below (which iterate meshesRef.current) keep working
        // unchanged.
        const { group: archGroup, report } = buildBuildingGroup(architecturalBuilding);
        if (report.warnings.length) console.warn('[architecture engine] validation warnings:', report.warnings);
        if (!report.valid) console.error('[architecture engine] validation errors:', report.errors);
        group.add(archGroup);
        meshes = [];
        const lines = [];
        const draggableGroups = [];
        archGroup.traverse((obj) => {
          if (obj.isMesh) meshes.push(obj);
          else if (obj.isLine) lines.push(obj);
          // A wall (or opening) is its own THREE.Group carrying one or more
          // layer meshes as children (see wallSystem.js Phase 2 — a wall
          // with a layered assembly renders as several stacked slabs, not
          // one mesh) — tagged with userData.wallId. Dragging a wall now
          // always moves this group, not an individual layer, so track it
          // here alongside the flat mesh list, with its own
          // originalPosition/originalRotationY already set at build time,
          // so "Reset positions" can restore it exactly like it does for
          // every mesh in `meshes`.
          else if (obj.isGroup && obj.userData.wallId != null) draggableGroups.push(obj);
        });
        groupsRef.current = draggableGroups;
        linesRef.current = lines;
      } else {
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
        meshes = isManualScene ? buildManualMeshes(inputParts).meshes : buildBuildingMeshes(inputParts);
        meshes.forEach(m => group.add(m));
        groupsRef.current = [];
        linesRef.current = [];
      }
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
      // old "1.2" this used to be are effectively invisible. Decay=1
      // (linear falloff) plus a much higher on-intensity actually lights a
      // room-scale interior.
      //
      // One light in the exact center of the whole building only lit the
      // middle room well and left rooms near the outer walls dark on
      // anything bigger than a single box — so place one light per
      // distinct room (from each mesh's userData.room, centroid of that
      // room's own parts) instead, falling back to the old single
      // building-center light when no part carries room info at all.
      const roomAccum = new Map(); // key -> { x, y, z, n, floor }
      meshes.forEach(m => {
        const room = m.userData.room;
        if (!room) return;
        const key = `${room}__${m.userData.floor ?? 1}`;
        const p = m.position;
        const acc = roomAccum.get(key) || { x: 0, y: 0, z: 0, n: 0, floor: m.userData.floor ?? 1 };
        acc.x += p.x; acc.y += p.y; acc.z += p.z; acc.n += 1;
        roomAccum.set(key, acc);
      });
      const interiorFills = [];
      if (roomAccum.size > 0) {
        // Cap the light count on very room-dense scenes to stay cheap.
        [...roomAccum.values()].slice(0, 24).forEach(acc => {
          const light = new THREE.PointLight(0xfff1d6, 0, Math.max(radius * 2.5, 5), 1);
          light.position.set(acc.x / acc.n, acc.y / acc.n + Math.max(radius * 0.35, 1.1), acc.z / acc.n);
          scene.add(light);
          interiorFills.push(light);
        });
      } else {
        const light = new THREE.PointLight(0xfff1d6, 0, Math.max(radius * 6, 10), 1);
        light.position.set(center.x, center.y + Math.max(radius * 1.4, 2), center.z);
        scene.add(light);
        interiorFills.push(light);
      }
      interiorFillRef.current = interiorFills;

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
            assembly: target.userData.assembly || null,
            assemblyLayers: target.userData.assemblyLayers || null,
          });
          if (editModeRef.current) {
            // A window/door's position is derived from its parent wall at
            // build time and its opening is CSG-cut directly into that
            // wall's geometry — the two aren't independent objects. Letting
            // the gizmo drag just the window's frame would pull it away
            // from its own hole, leaving a mismatched cut behind. Dragging
            // the whole wall (openings included) keeps them attached, the
            // way section 27 of the spec expects.
            let dragTarget = target;
            let redirectedToWall = false;
            if (target.userData.group === 'window' || target.userData.group === 'door' || target.userData.group === 'structure') {
              // Climb from the hit mesh's parent (never the mesh itself,
              // even though a structure-layer mesh already carries its own
              // wallId — a layered wall renders as several sibling slabs
              // under one wall Group, and every layer plus every opening
              // fill needs to move together, so the whole Group is always
              // the real drag target here, not whichever single layer got
              // clicked).
              let ancestor = target.parent;
              while (ancestor && ancestor.userData.wallId == null) ancestor = ancestor.parent;
              if (ancestor) { dragTarget = ancestor; redirectedToWall = true; }
            }
            setDragIsWholeWall(redirectedToWall);
            transformControls.attach(dragTarget);
            transformControls.setMode(transformModeRef.current);
            transformControls.enabled = true;
            transformControls.visible = true;
          }
        } else {
          transformControls.detach();
          transformControls.enabled = false;
          transformControls.visible = false;
          setSelectedLabel(null);
          setDragIsWholeWall(false);
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
  }, [modelSpec, started, architecturalBuilding]);

  useEffect(() => {
    meshesRef.current.forEach(m => { m.material.wireframe = wireframe; });
    // Re-run whenever a new scene is built too, not just when the button
    // itself is toggled — materialSystem.js now caches/shares material
    // instances, so a fresh building's meshes could otherwise inherit a
    // stale wireframe=true left over from a previously viewed building
    // that happened to share the same cached material.
  }, [wireframe, modelSpec, architecturalBuilding]);

  useEffect(() => {
    meshesRef.current.forEach(m => { if (m.userData.group === 'roof') m.visible = !hideRoof; });
    // Was "1.2", which is essentially invisible under physically-correct
    // (candela) point-light units — that's the direct cause of the very
    // dark/black interior floor in the "Show interior" screenshots.
    if (interiorFillRef.current) interiorFillRef.current.forEach(l => { l.intensity = hideRoof ? 55 : 0; });
  }, [hideRoof, modelSpec]);

  useEffect(() => {
    // Both refs, not just meshesRef — MEP conduit runs are THREE.Line
    // (dashed, deliberately, to read as schematic wiring rather than a
    // physical pipe), and Line objects aren't picked up by an isMesh-only
    // toggle. See linesRef's declaration comment for why this is a fix,
    // not just belt-and-suspenders.
    meshesRef.current.forEach(m => { if (m.userData.group === 'mep') m.visible = showMep; });
    linesRef.current.forEach(l => { if (l.userData.group === 'mep') l.visible = showMep; });
  }, [showMep, modelSpec]);

  useEffect(() => {
    meshesRef.current.forEach(m => {
      const override = colorOverrides[m.userData.group];
      if (!override) return;
      // A layered wall's structural core (raw block/concrete, not meant to
      // be "painted") shouldn't flatten to the same swatch color as its
      // finish coats — only the render/plaster/board finish layers (and
      // any single-layer wall, which has no layerRole at all) respond to
      // the wall color swatch.
      if (m.userData.layerRole === 'structural') return;
      // materialSystem.js caches materials by their params, so many meshes
      // across a building (and across other buildings/projects loaded
      // later in the same session) can share ONE material instance.
      // Mutating .color in place would leak this override onto every mesh
      // sharing that cached instance, including ones in a completely
      // different building loaded afterward. Clone once per mesh on first
      // override (tagged so a second color pick on the same mesh just
      // mutates its own already-private clone instead of re-cloning), so
      // the shared cache stays untouched for everyone else.
      if (!m.material.userData?.isOverrideClone) {
        m.material = m.material.clone();
        m.material.userData = { ...m.material.userData, isOverrideClone: true };
      }
      m.material.color.set(override);
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
    groupsRef.current.forEach(g => {
      if (g.userData.originalPosition) g.position.copy(g.userData.originalPosition);
      if (g.userData.originalRotationY != null) g.rotation.y = g.userData.originalRotationY;
    });
    if (transformRef.current) {
      transformRef.current.detach();
      transformRef.current.enabled = false;
      transformRef.current.visible = false;
    }
    setSelectedLabel(null);
          setDragIsWholeWall(false);
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
          <p className="page-sub" style={{ marginTop: 16, fontSize: 12, opacity: 0.75 }}>New architecture engine — Phase 1 preview (not yet wired to Chat/Blueprint/Estate AI):</p>
          <div className="viewer-controls" style={{ marginTop: 6 }}>
            <button onClick={() => runArchitectureDemo('bungalow')}>Demo: Bungalow</button>
            <button onClick={() => runArchitectureDemo('duplex')}>Demo: Duplex</button>
            <button onClick={() => runArchitectureDemo('threeStorey')}>Demo: 3-Storey</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="viewer-shell">
      <span className="viewer-tag">3D preview · drag to orbit · tap a part for details</span>
      {architecturalBuilding && (
        <span className="viewer-hint">New architecture engine active{architecturalBuilding.name ? ` — ${architecturalBuilding.name}` : ''}</span>
      )}
      {editMode && (
        <span className="viewer-hint">{selectedLabel ? `Editing: ${selectedLabel}${dragIsWholeWall ? ' (moves its whole wall — windows/doors are cut into the wall, not separate)' : ''} — drag to ${transformMode === 'rotate' ? 'rotate' : 'move'}` : 'Tap a part to select it'}</span>
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
        {architecturalBuilding && (
          <button className={showMep ? 'active' : ''} onClick={() => setShowMep(v => !v)} title="Electrical conduit/sockets/lighting and plumbing supply/drain routing — schematic, not a certified M&E design">
            {showMep ? 'Hide MEP' : 'Show MEP'}
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
