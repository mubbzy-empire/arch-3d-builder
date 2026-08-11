import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildManualMeshes, getShadowTexture } from '../three/buildParts';

let idCounter = 0;
const genId = () => `p${Date.now().toString(36)}${(idCounter++).toString(36)}`;

const DEFAULTS = {
  wallHeight: 3,
  wallThickness: 0.15,
  doorSize: [0.9, 2.1],
  windowSize: [1.2, 1.2],
  windowSill: 0.9,
};

const TOOLS = [
  { id: 'select', label: 'Select' },
  { id: 'wall', label: 'Wall' },
  { id: 'door', label: 'Door' },
  { id: 'window', label: 'Window' },
  { id: 'box', label: 'Box' },
  { id: 'cylinder', label: 'Cylinder' },
];

function partDisplayName(part, index) {
  if (part.group === 'structure') return part.name || `Wall ${index + 1}`;
  if (part.group === 'door') return part.name || `Door ${index + 1}`;
  if (part.group === 'window') return part.name || `Window ${index + 1}`;
  if (part.type === 'cylinder') return part.name || `Cylinder ${index + 1}`;
  return part.name || `Box ${index + 1}`;
}

export default function ManualModeler() {
  const navigate = useNavigate();
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const transformRef = useRef(null);
  const meshGroupRef = useRef(null);
  const meshMapRef = useRef({});
  const groundPlaneRef = useRef(null);
  const dragStartRef = useRef(null);

  const [editor, setEditor] = useState({ parts: [], history: [], future: [] });
  const [tool, setTool] = useState('select');
  const [selectedId, setSelectedId] = useState(null);
  const [wallDraftActive, setWallDraftActive] = useState(false);
  const [transformMode, setTransformMode] = useState('translate');
  const [title, setTitle] = useState('My design');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [buildError, setBuildError] = useState(null);

  const partsRef = useRef(editor.parts);
  const toolRef = useRef(tool);
  const selectedIdRef = useRef(selectedId);
  const wallDraftRef = useRef(null);
  const transformModeRef = useRef('translate');

  useEffect(() => { partsRef.current = editor.parts; }, [editor.parts]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { if (tool !== 'wall') { wallDraftRef.current = null; setWallDraftActive(false); } }, [tool]);
  useEffect(() => {
    transformModeRef.current = transformMode;
    if (transformRef.current) transformRef.current.setMode(transformMode);
  }, [transformMode]);

  const selectedPart = useMemo(() => editor.parts.find(p => p.id === selectedId) || null, [editor.parts, selectedId]);

  // Commits ONLY use functional setState updaters internally, so this
  // function is safe to call even from a "stale" closure captured once at
  // mount time (the three.js pointer handlers below) — it never reads
  // `editor` from outer scope, only from the updater argument it receives.
  const commit = (updater) => {
    setEditor(ed => {
      const nextParts = typeof updater === 'function' ? updater(ed.parts) : updater;
      return { parts: nextParts, history: [...ed.history.slice(-49), ed.parts], future: [] };
    });
  };
  const undo = () => setEditor(ed => {
    if (!ed.history.length) return ed;
    const prev = ed.history[ed.history.length - 1];
    return { parts: prev, history: ed.history.slice(0, -1), future: [ed.parts, ...ed.future] };
  });
  const redo = () => setEditor(ed => {
    if (!ed.future.length) return ed;
    const next = ed.future[0];
    return { parts: next, history: [...ed.history, ed.parts], future: ed.future.slice(1) };
  });

  const addPart = (part) => {
    commit(prev => [...prev, part]);
    setSelectedId(part.id);
  };

  const updateSelected = (changes) => {
    if (!selectedId) return;
    commit(prev => prev.map(p => (p.id === selectedId ? { ...p, ...changes } : p)));
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    commit(prev => prev.filter(p => p.id !== selectedId && p.wallId !== selectedId));
    setSelectedId(null);
  };

  const duplicateSelected = () => {
    if (!selectedPart) return;
    const copy = { ...selectedPart, id: genId(), position: [selectedPart.position[0] + 0.5, selectedPart.position[1], selectedPart.position[2] + 0.5] };
    addPart(copy);
  };

  // ---- One-time scene setup (camera/renderer/controls persist across edits) ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cleanup = () => {};
    try {
      const width = mount.clientWidth, height = mount.clientHeight;
      const scene = new THREE.Scene();
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 400);
      camera.position.set(9, 8, 11);
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
      rendererRef.current = renderer;

      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;
      pmrem.dispose();

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.target.set(0, 0.5, 0);
      controlsRef.current = controls;

      const key = new THREE.DirectionalLight(0xffffff, 1.2);
      key.position.set(8, 12, 6);
      key.castShadow = true;
      key.shadow.mapSize.set(1536, 1536);
      key.shadow.camera.left = -20; key.shadow.camera.right = 20;
      key.shadow.camera.top = 20; key.shadow.camera.bottom = -20;
      scene.add(key);
      scene.add(new THREE.DirectionalLight(0x88aacc, 0.25));
      scene.add(new THREE.AmbientLight(0x40454e, 0.6));

      const grid = new THREE.GridHelper(40, 40, 0x40484f, 0x252b31);
      scene.add(grid);

      const groundPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(400, 400),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      groundPlane.rotation.x = -Math.PI / 2;
      scene.add(groundPlane);
      groundPlaneRef.current = groundPlane;

      const shadowDisc = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        new THREE.MeshBasicMaterial({ map: getShadowTexture(), transparent: true, opacity: 0.35, depthWrite: false })
      );
      shadowDisc.rotation.x = -Math.PI / 2;
      shadowDisc.position.y = 0.005;
      scene.add(shadowDisc);

      const meshGroup = new THREE.Group();
      meshGroupRef.current = meshGroup;
      scene.add(meshGroup);

      // Draft marker for the wall tool's first click
      const draftMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xf3c581 })
      );
      draftMarker.visible = false;
      scene.add(draftMarker);

      const transformControls = new TransformControls(camera, renderer.domElement);
      transformControls.setMode(transformModeRef.current);
      transformControls.setSize(0.85);
      transformControls.enabled = false;
      transformControls.visible = false;
      scene.add(transformControls.getHelper ? transformControls.getHelper() : transformControls);
      transformRef.current = transformControls;

      transformControls.addEventListener('dragging-changed', (e) => {
        controls.enabled = !e.value;
        if (e.value) {
          dragStartRef.current = transformControls.object
            ? { position: transformControls.object.position.clone(), rotationY: transformControls.object.rotation.y }
            : null;
        } else if (dragStartRef.current && transformControls.object) {
          const obj = transformControls.object;
          const delta = obj.position.clone().sub(dragStartRef.current.position);
          const rotationChanged = Math.abs(obj.rotation.y - dragStartRef.current.rotationY) > 1e-4;
          const partId = obj.userData.partId;
          commit(prev => prev.map(p => {
            if (p.id === partId) {
              const next = { ...p, position: [obj.position.x, obj.position.y, obj.position.z] };
              if (rotationChanged) next.rotation = obj.rotation.y;
              return next;
            }
            if (p.wallId === partId && (delta.x !== 0 || delta.y !== 0 || delta.z !== 0)) {
              const [px, py, pz] = p.position;
              return { ...p, position: [px + delta.x, py + delta.y, pz + delta.z] };
            }
            return p;
          }));
          dragStartRef.current = null;
        }
      });

      const raycaster = new THREE.Raycaster();
      const pointerNdc = new THREE.Vector2();
      let downPos = null;

      const groundHit = (e) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObject(groundPlane, false);
        return hits.length ? hits[0].point : null;
      };

      const meshHit = (e, objects) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObjects(objects, false);
        return hits.length ? hits[0] : null;
      };

      const onPointerDown = (e) => { downPos = { x: e.clientX, y: e.clientY }; };
      const onPointerUp = (e) => {
        if (transformControls.dragging) return;
        if (downPos) {
          const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
          if (moved > 6) return;
        }
        const currentTool = toolRef.current;
        const allMeshes = Object.values(meshMapRef.current).flat();

        if (currentTool === 'select') {
          const hit = meshHit(e, allMeshes);
          if (hit) {
            const partId = hit.object.userData.partId;
            setSelectedId(partId);
            transformControls.attach(hit.object);
            transformControls.setMode(transformModeRef.current);
            transformControls.enabled = true;
            transformControls.visible = true;
          } else {
            setSelectedId(null);
            transformControls.detach();
            transformControls.enabled = false;
            transformControls.visible = false;
          }
          return;
        }

        if (currentTool === 'wall') {
          const point = groundHit(e);
          if (!point) return;
          if (!wallDraftRef.current) {
            wallDraftRef.current = { x: point.x, z: point.z };
            draftMarker.position.set(point.x, 0.05, point.z);
            draftMarker.visible = true;
            setWallDraftActive(true);
          } else {
            const start = wallDraftRef.current;
            const dx = point.x - start.x;
            const dz = point.z - start.z;
            const length = Math.max(Math.hypot(dx, dz), 0.3);
            const rotation = Math.atan2(-dz, dx);
            const midX = (start.x + point.x) / 2;
            const midZ = (start.z + point.z) / 2;
            addPart({
              id: genId(), type: 'box', group: 'structure', floor: 1,
              size: [length, DEFAULTS.wallHeight, DEFAULTS.wallThickness],
              position: [midX, DEFAULTS.wallHeight / 2, midZ],
              rotation, material: 'wood', color: '#d8cdb8',
            });
            wallDraftRef.current = null;
            draftMarker.visible = false;
            setWallDraftActive(false);
          }
          return;
        }

        if (currentTool === 'door' || currentTool === 'window') {
          const wallMeshes = allMeshes.filter(m => m.userData.group === 'structure');
          const hit = meshHit(e, wallMeshes);
          if (!hit) return;
          const wallId = hit.object.userData.partId;
          const wall = partsRef.current.find(p => p.id === wallId);
          if (!wall) return;
          const [wx, , wz] = wall.position;
          const rot = wall.rotation || 0;
          const dx = hit.point.x - wx, dz = hit.point.z - wz;
          const localX = dx * Math.cos(rot) - dz * Math.sin(rot); // project world hit onto the wall's own length axis
          const [openW, openH] = currentTool === 'door' ? DEFAULTS.doorSize : DEFAULTS.windowSize;
          const half = Math.max(wall.size[0] / 2 - openW / 2 - 0.1, 0);
          const clamped = Math.max(-half, Math.min(half, localX));
          const worldX = wx + clamped * Math.cos(rot);
          const worldZ = wz - clamped * Math.sin(rot);
          const sillY = currentTool === 'door' ? openH / 2 : DEFAULTS.windowSill + openH / 2;
          addPart({
            id: genId(), group: currentTool, wallId, floor: wall.floor ?? 1,
            size: [openW, openH, wall.size[2]],
            position: [worldX, sillY, worldZ],
            material: currentTool === 'door' ? 'wood' : 'glass',
            color: currentTool === 'door' ? '#6b4a2f' : undefined,
          });
          return;
        }

        if (currentTool === 'box' || currentTool === 'cylinder') {
          const point = groundHit(e);
          if (!point) return;
          if (currentTool === 'box') {
            addPart({
              id: genId(), type: 'box', group: 'object', floor: 1,
              size: [0.8, 0.8, 0.8], position: [point.x, 0.4, point.z],
              material: 'wood', color: '#8a6d5c',
            });
          } else {
            addPart({
              id: genId(), type: 'cylinder', group: 'object', floor: 1,
              radiusTop: 0.35, radiusBottom: 0.35, height: 0.8,
              position: [point.x, 0.4, point.z], material: 'metal',
            });
          }
        }
      };

      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointerup', onPointerUp);

      let frameId;
      const animate = () => { frameId = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
      animate();

      const handleResize = () => {
        const w = mount.clientWidth, h = mount.clientHeight;
        camera.aspect = w / h; camera.updateProjectionMatrix();
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
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      };
    } catch (err) {
      console.error('Manual modeler failed to initialize:', err);
      setBuildError(err.message || String(err));
    }
    return () => cleanup();
  }, []);

  // ---- Rebuild just the geometry whenever parts change (camera/controls untouched) ----
  useEffect(() => {
    const group = meshGroupRef.current;
    if (!group) return;
    try {
      [...group.children].forEach(m => { group.remove(m); m.geometry?.dispose?.(); m.material?.dispose?.(); });
      const { meshes, idToMeshes } = buildManualMeshes(editor.parts);
      meshes.forEach(m => group.add(m));
      meshMapRef.current = idToMeshes;

      // Re-attach the transform gizmo to the (possibly rebuilt) selected mesh.
      const tc = transformRef.current;
      if (tc && selectedIdRef.current && idToMeshes[selectedIdRef.current]) {
        tc.attach(idToMeshes[selectedIdRef.current][0]);
      } else if (tc) {
        tc.detach();
        tc.enabled = false;
        tc.visible = false;
      }
    } catch (err) {
      console.error('Manual modeler failed to rebuild geometry:', err);
      setBuildError(err.message || String(err));
    }
  }, [editor.parts]);

  useEffect(() => {
    const tc = transformRef.current;
    if (!tc) return;
    if (tool !== 'select') {
      tc.detach(); tc.enabled = false; tc.visible = false;
    } else if (selectedId && meshMapRef.current[selectedId]) {
      tc.attach(meshMapRef.current[selectedId][0]);
      tc.enabled = true; tc.visible = true;
    }
  }, [tool, selectedId]);

  const saveDesign = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/analyze/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, parts: editor.parts }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      const { id } = await res.json();
      navigate(`/results/${id}`);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const hintText = () => {
    if (tool === 'select') return selectedPart ? 'Drag the arrow to move — use the panel to edit size/material' : 'Tap a part to select it';
    if (tool === 'wall') return wallDraftActive ? "Tap the wall's end point" : "Tap the wall's start point";
    if (tool === 'door' || tool === 'window') return `Tap an existing wall to place a ${tool}`;
    return 'Tap the ground to place it';
  };

  return (
    <div className="screen">
      <div>
        <div className="eyebrow">Manual 3D modeler</div>
        <h1 className="page-title" style={{ marginTop: 10 }}>Build from scratch</h1>
        <p className="page-sub" style={{ marginTop: 10 }}>
          Draw real walls point-to-point, cut real door/window openings into them, and place freestanding pieces —
          no AI involved. Everything here is a real 3D primitive you fully control.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TOOLS.map(t => (
          <button key={t.id} className={tool === t.id ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => setTool(t.id)}>
            {t.label}
          </button>
        ))}
        <button className="btn btn-ghost" onClick={undo} disabled={!editor.history.length}>Undo</button>
        <button className="btn btn-ghost" onClick={redo} disabled={!editor.future.length}>Redo</button>
        <button
          className={transformMode === 'translate' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => setTransformMode('translate')}
          title="Move the selected part"
        >
          Move
        </button>
        <button
          className={transformMode === 'rotate' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => setTransformMode('rotate')}
          title="Rotate the selected part — works best on freestanding boxes/cylinders, since rotating a wall won't carry its doors and windows along with it"
        >
          Rotate
        </button>
      </div>

      {buildError ? (
        <div className="viewer-shell" style={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <p className="page-sub" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{buildError}</p>
        </div>
      ) : (
        <div className="viewer-shell">
          <span className="viewer-tag">{hintText()}</span>
          <div className="viewer-canvas" ref={mountRef} style={{ height: 420 }} />
        </div>
      )}

      <div className="split-layout">
        <div className="split-main">
          <div className="panel bracket">
            <div className="section-head"><h3>Scene Explorer</h3><span className="count">{editor.parts.length} objects</span></div>
            {editor.parts.length === 0 && <p className="page-sub" style={{ fontSize: 12.5 }}>Empty scene — pick a tool above and start building.</p>}
            <div className="scene-explorer">
              {editor.parts.map((p, i) => (
                <div key={p.id} className={`scene-explorer-item${selectedId === p.id ? ' active' : ''}`} onClick={() => { setTool('select'); setSelectedId(p.id); }} role="button">
                  <span className="name">{partDisplayName(p, i)}{p.wallId ? ' (attached)' : ''}</span>
                  <span className="badge" style={{ fontSize: 10 }}>{p.group}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="split-side">
          <div className="panel bracket">
            <div className="section-head"><h3>Properties</h3></div>
            {!selectedPart && <p className="page-sub" style={{ fontSize: 12.5 }}>Select an object to edit it.</p>}
            {selectedPart && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {selectedPart.size && (
                  <>
                    <label className="spec-label">Width / length (m)</label>
                    <input type="number" step="0.05" value={selectedPart.size[0]} onChange={e => updateSelected({ size: [Number(e.target.value), selectedPart.size[1], selectedPart.size[2]] })} />
                    <label className="spec-label">Height (m)</label>
                    <input type="number" step="0.05" value={selectedPart.size[1]} onChange={e => updateSelected({ size: [selectedPart.size[0], Number(e.target.value), selectedPart.size[2]] })} />
                    <label className="spec-label">{selectedPart.group === 'structure' ? 'Thickness (m)' : 'Depth (m)'}</label>
                    <input type="number" step="0.02" value={selectedPart.size[2]} onChange={e => updateSelected({ size: [selectedPart.size[0], selectedPart.size[1], Number(e.target.value)] })} />
                  </>
                )}
                <label className="spec-label">Material</label>
                <select value={selectedPart.material || 'wood'} onChange={e => updateSelected({ material: e.target.value })}>
                  <option value="wood">Wood</option>
                  <option value="metal">Metal</option>
                  <option value="glass">Glass</option>
                  <option value="fabric">Fabric</option>
                </select>
                <label className="spec-label">Color</label>
                <input type="color" value={selectedPart.color || '#c9a26a'} onChange={e => updateSelected({ color: e.target.value })} />
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button className="btn btn-secondary" style={{ flex: 1 }} onClick={duplicateSelected}>Duplicate</button>
                  <button className="btn btn-secondary" style={{ flex: 1, color: 'var(--danger)' }} onClick={deleteSelected}>Delete</button>
                </div>
              </div>
            )}
          </div>

          <div className="panel bracket">
            <div className="section-head"><h3>Save design</h3></div>
            <input type="text" placeholder="Design title" value={title} onChange={e => setTitle(e.target.value)} style={{ marginBottom: 10 }} />
            {saveError && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{saveError}</p>}
            <button className="btn btn-primary btn-block" disabled={!editor.parts.length || saving} onClick={saveDesign}>
              {saving ? 'Saving…' : 'Save & view'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
