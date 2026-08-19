// ---------------------------------------------------------------------------
// Drafting2D.jsx
//
// A real 2D CAD plan-view — orthographic top-down, grid-snapped, dimensioned
// — for the manual modeler, alongside its existing 3D view. This is not a
// separate design surface: it reads and writes the exact same `parts` array
// ManualModeler.jsx already maintains (wall = group:'structure', door/
// window = group:'door'/'window' with a wallId), using the identical
// geometry formulas ManualModeler's own 3D click-handlers use (see
// draftingMath.js's header comment) — so a wall drawn here and a wall drawn
// by clicking in the 3D view are indistinguishable in the data they produce,
// and both immediately show up in the other view and in the 3D-generated
// blueprint export.
//
// Scope, stated plainly: this covers the tools this app's data model
// actually has today — wall / door / window / select / delete — with real
// CAD fundamentals around them (grid snap, angle-lock, pan/zoom, dimension
// labels, keyboard shortcuts drawn from the ArchiCAD 2D reference sheet
// where they don't collide with a browser-reserved key). It does not
// attempt columns/beams/slabs/roofs/arcs/splines from that reference sheet
// — this app's building model doesn't have those primitives yet, and
// binding a key to a tool that doesn't exist would be worse than not
// binding it.
// ---------------------------------------------------------------------------
import React, { useEffect, useRef, useState } from 'react';
import {
  worldToScreen, screenToWorld, snapToGrid, snapAngle,
  wallPartFromPoints, wallEndpoints, pointToSegmentDistance, openingPartOnWall,
} from './draftingMath.js';

const CLICK_THRESHOLD_PX = 6;
const WALL_HIT_TOLERANCE_M = 0.35;
const GRID_SIZES = [0.1, 0.25, 0.5, 1];

// ManualModeler's own `addPart` never generates an id itself — every one of
// its existing call sites passes `id: genId()` already set. This canvas has
// to do the same (a part added here with no id would break wallId
// references, hit-testing, and selection the moment it's added) — a
// separately-prefixed counter so it can never collide with ManualModeler's
// own `p...` ids.
let idCounter2D = 0;
const genId2D = () => `d2d${Date.now().toString(36)}${(idCounter2D++).toString(36)}`;

export default function Drafting2D({
  parts, tool, selectedId, floor = 1, defaults,
  onSelect, addPart, commit, deleteSelected, setTool, undo, redo,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const viewRef = useRef({ originX: 0, originY: 0, scale: 40 }); // 40px/metre default
  const mouseWorldRef = useRef({ x: 0, z: 0 });
  const wallDraftRef = useRef(null); // {x,z} start point while drawing a wall
  const dragRef = useRef(null); // active select-tool drag: {id, startWorld, downScreen, moved}
  const panRef = useRef(null); // active pan drag: {startScreen, startOrigin}
  const shiftRef = useRef(false);
  const [gridSize, setGridSize] = useState(0.1);
  const gridSizeRef = useRef(gridSize);
  useEffect(() => { gridSizeRef.current = gridSize; }, [gridSize]);

  const partsRef = useRef(parts);
  useEffect(() => { partsRef.current = parts; }, [parts]);
  const toolRef = useRef(tool);
  useEffect(() => { toolRef.current = tool; if (tool !== 'wall') wallDraftRef.current = null; }, [tool]);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const wallsOnFloor = () => partsRef.current.filter((p) => p.group === 'structure' && (p.floor ?? 1) === floor);
  const openingsOnFloor = () => partsRef.current.filter((p) => (p.group === 'door' || p.group === 'window') && (p.floor ?? 1) === floor);

  const nearestWall = (worldPoint) => {
    let best = null, bestDist = Infinity;
    for (const wall of wallsOnFloor()) {
      const { start, end } = wallEndpoints(wall);
      const d = pointToSegmentDistance(worldPoint, start, end);
      if (d < bestDist) { bestDist = d; best = wall; }
    }
    return bestDist <= WALL_HIT_TOLERANCE_M ? best : null;
  };

  const nearestOpening = (worldPoint) => {
    let best = null, bestDist = Infinity;
    for (const o of openingsOnFloor()) {
      const d = Math.hypot(worldPoint.x - o.position[0], worldPoint.z - o.position[2]);
      if (d < bestDist) { bestDist = d; best = o; }
    }
    return bestDist <= WALL_HIT_TOLERANCE_M ? best : null;
  };

  // ---- Fit the view to whatever's already drawn, once on mount / when
  // asked to via the "Home" shortcut — same idea as the 3D view's implicit
  // camera framing on load. ----
  const fitToContent = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const walls = wallsOnFloor();
    if (!walls.length) {
      viewRef.current = { originX: rect.width / 2, originY: rect.height / 2, scale: 40 };
      return;
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const wall of walls) {
      const { start, end } = wallEndpoints(wall);
      for (const p of [start, end]) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
    }
    const pad = 2; // metres of breathing room
    const spanX = Math.max(maxX - minX + pad * 2, 1);
    const spanZ = Math.max(maxZ - minZ + pad * 2, 1);
    const scale = Math.max(4, Math.min(rect.width / spanX, rect.height / spanZ, 200));
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    viewRef.current = { originX: rect.width / 2 - cx * scale, originY: rect.height / 2 + cz * scale, scale };
  };

  // ---- Draw loop ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    let frameId;
    let ro;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    fitToContent();
    ro = new ResizeObserver(resize);
    ro.observe(container);

    const draw = () => {
      frameId = requestAnimationFrame(draw);
      const rect = container.getBoundingClientRect();
      const view = viewRef.current;
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = '#0d1014';
      ctx.fillRect(0, 0, rect.width, rect.height);

      // Grid — a metre grid with a heavier line every 5m, so distances are
      // readable at a glance the way a real drafting sheet's grid is.
      const g = gridSizeRef.current || 1;
      const step = g < 1 ? 1 : g; // draw at 1m even if snap grid is finer, or it turns to noise
      const startWorldX = Math.floor(screenToWorld(0, 0, view).x / step) * step;
      const endWorldX = Math.ceil(screenToWorld(rect.width, 0, view).x / step) * step;
      const startWorldZ = Math.floor(screenToWorld(0, rect.height, view).z / step) * step;
      const endWorldZ = Math.ceil(screenToWorld(0, 0, view).z / step) * step;
      for (let x = startWorldX; x <= endWorldX; x += step) {
        const sx = worldToScreen(x, 0, view).x;
        ctx.strokeStyle = Math.round(x / 5) === x / 5 ? '#262c34' : '#181c21';
        ctx.lineWidth = Math.round(x / 5) === x / 5 ? 1 : 0.5;
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, rect.height); ctx.stroke();
      }
      for (let z = startWorldZ; z <= endWorldZ; z += step) {
        const sy = worldToScreen(0, z, view).y;
        ctx.strokeStyle = Math.round(z / 5) === z / 5 ? '#262c34' : '#181c21';
        ctx.lineWidth = Math.round(z / 5) === z / 5 ? 1 : 0.5;
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(rect.width, sy); ctx.stroke();
      }
      // Origin cross
      const originPt = worldToScreen(0, 0, view);
      ctx.strokeStyle = '#3a4048'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(originPt.x - 10, originPt.y); ctx.lineTo(originPt.x + 10, originPt.y); ctx.moveTo(originPt.x, originPt.y - 10); ctx.lineTo(originPt.x, originPt.y + 10); ctx.stroke();

      // Walls — drawn as their true thickness (a filled quad), not a thin
      // line, so the plan reads like a real architectural drawing.
      for (const wall of wallsOnFloor()) {
        const { start, end } = wallEndpoints(wall);
        const thickness = wall.size[2] || 0.15;
        const dx = end.x - start.x, dz = end.z - start.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len, nz = dx / len; // unit normal (perpendicular to the wall)
        const hw = thickness / 2;
        const corners = [
          worldToScreen(start.x + nx * hw, start.z + nz * hw, view),
          worldToScreen(end.x + nx * hw, end.z + nz * hw, view),
          worldToScreen(end.x - nx * hw, end.z - nz * hw, view),
          worldToScreen(start.x - nx * hw, start.z - nz * hw, view),
        ];
        const isSelected = wall.id === selectedIdRef.current;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.fillStyle = isSelected ? '#e2a24d' : '#cfc7b6';
        ctx.fill();
        ctx.strokeStyle = isSelected ? '#f3c581' : '#3a4048';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.stroke();

        // Dimension label at the wall's midpoint, offset to one side —
        // always-on, the way a working drawing shows every wall's length
        // rather than requiring a separate manual "place a dimension"
        // step for a residential-scale plan. Angle is derived from the
        // already-computed SCREEN points (not re-derived from world dx/dz
        // and a guessed sign), so it's correct by construction regardless
        // of canvas rotate()'s clockwise/counter-clockwise convention —
        // and flipped 180° when that would render the text upside down,
        // so a dimension is always readable left-to-right.
        const midX = (start.x + end.x) / 2, midZ = (start.z + end.z) / 2;
        const labelPos = worldToScreen(midX + nx * (hw + 0.35), midZ + nz * (hw + 0.35), view);
        let screenAngle = Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x);
        if (screenAngle > Math.PI / 2 || screenAngle < -Math.PI / 2) screenAngle += Math.PI;
        ctx.save();
        ctx.translate(labelPos.x, labelPos.y);
        ctx.rotate(screenAngle);
        ctx.fillStyle = '#8b93a1';
        ctx.font = '11px var(--font-mono, monospace)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${(len).toFixed(2)}m`, 0, 0);
        ctx.restore();
      }

      // Openings — a gap-marker (door: quarter-circle swing, window: double
      // line) at their position along whichever wall they belong to. Every
      // point here is computed in WORLD space first and projected to screen
      // last (the same approach the wall quad above uses) — deliberately
      // not using ctx.rotate() for the geometry itself, only for the text
      // label above, so there's no rotation-sign convention to get wrong.
      for (const o of openingsOnFloor()) {
        const wall = wallsOnFloor().find((w) => w.id === o.wallId);
        let dirX = 1, dirZ = 0;
        if (wall) {
          const { start: ws, end: we } = wallEndpoints(wall);
          const wdx = we.x - ws.x, wdz = we.z - ws.z;
          const wlen = Math.hypot(wdx, wdz) || 1;
          dirX = wdx / wlen; dirZ = wdz / wlen;
        }
        const halfWm = o.size[0] / 2;
        const p1 = worldToScreen(o.position[0] - dirX * halfWm, o.position[2] - dirZ * halfWm, view);
        const p2 = worldToScreen(o.position[0] + dirX * halfWm, o.position[2] + dirZ * halfWm, view);
        const isSelected = o.id === selectedIdRef.current;
        ctx.strokeStyle = isSelected ? '#f3c581' : (o.group === 'door' ? '#6b4a2f' : '#5fa8d3');
        ctx.lineWidth = isSelected ? 2.5 : 2;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        if (o.group === 'door') {
          // Standard plan symbol: a quarter-circle swing from one jamb,
          // radius equal to the door width, traced as a world-space
          // polyline (12 segments) then projected to screen point-by-point.
          const nx = -dirZ, nz = dirX;
          const pivotX = o.position[0] - dirX * halfWm, pivotZ = o.position[2] - dirZ * halfWm;
          const radius = o.size[0];
          ctx.beginPath();
          const steps = 12;
          for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * (Math.PI / 2);
            const wx = pivotX + Math.cos(t) * dirX * radius + Math.sin(t) * nx * radius;
            const wz = pivotZ + Math.cos(t) * dirZ * radius + Math.sin(t) * nz * radius;
            const sp = worldToScreen(wx, wz, view);
            if (i === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
          }
          ctx.stroke();
        }
      }

      // Live wall draft preview — from the first click to the current
      // mouse position, with a running length/angle readout.
      if (wallDraftRef.current && toolRef.current === 'wall') {
        const start = wallDraftRef.current;
        let mp = mouseWorldRef.current;
        let dx = mp.x - start.x, dz = mp.z - start.z;
        if (shiftRef.current) ({ dx, dz } = snapAngle(dx, dz));
        const end = { x: start.x + dx, z: start.z + dz };
        const p1 = worldToScreen(start.x, start.z, view);
        const p2 = worldToScreen(end.x, end.z, view);
        ctx.strokeStyle = '#f3c581'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        ctx.setLineDash([]);
        const len = Math.hypot(dx, dz);
        const angDeg = ((Math.atan2(-dz, dx) * 180) / Math.PI + 360) % 360;
        ctx.fillStyle = '#f3c581';
        ctx.font = '12px var(--font-mono, monospace)';
        ctx.fillText(`${len.toFixed(2)}m  ${angDeg.toFixed(0)}°${shiftRef.current ? '  (locked)' : ''}`, p2.x + 10, p2.y - 10);
      }
    };
    frameId = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frameId); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor]);

  // ---- Pointer interaction ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const toWorld = (e) => {
      const rect = canvas.getBoundingClientRect();
      const raw = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, viewRef.current);
      const g = gridSizeRef.current;
      return { x: snapToGrid(raw.x, g), z: snapToGrid(raw.z, g), rawX: raw.x, rawZ: raw.z };
    };

    const onMouseMove = (e) => {
      const w = toWorld(e);
      mouseWorldRef.current = { x: w.x, z: w.z };

      if (panRef.current) {
        const dxScreen = e.clientX - panRef.current.startScreen.x;
        const dyScreen = e.clientY - panRef.current.startScreen.y;
        viewRef.current = {
          ...viewRef.current,
          originX: panRef.current.startOrigin.originX + dxScreen,
          originY: panRef.current.startOrigin.originY + dyScreen,
        };
        return;
      }

      if (dragRef.current) {
        const moved = Math.hypot(e.clientX - dragRef.current.downScreen.x, e.clientY - dragRef.current.downScreen.y);
        if (moved > CLICK_THRESHOLD_PX) dragRef.current.moved = true;
      }
    };

    const onMouseDown = (e) => {
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        e.preventDefault();
        panRef.current = { startScreen: { x: e.clientX, y: e.clientY }, startOrigin: { ...viewRef.current } };
        return;
      }
      if (e.button !== 0) return;
      const w = toWorld(e);

      if (toolRef.current === 'select') {
        const wall = nearestWall({ x: w.rawX, z: w.rawZ });
        const opening = wall ? null : nearestOpening({ x: w.rawX, z: w.rawZ });
        const hitId = wall ? wall.id : opening ? opening.id : null;
        if (hitId) onSelect(hitId);
        dragRef.current = hitId
          ? { id: hitId, isWall: !!wall, downScreen: { x: e.clientX, y: e.clientY }, startWorld: { x: w.x, z: w.z }, moved: false }
          : null;
        if (!hitId) onSelect(null);
      }
    };

    const onMouseUp = (e) => {
      if (panRef.current) { panRef.current = null; return; }

      const w = toWorld(e);

      if (dragRef.current) {
        const wasClick = !dragRef.current.moved;
        if (!wasClick && dragRef.current.isWall) {
          const dxWorld = w.x - dragRef.current.startWorld.x;
          const dzWorld = w.z - dragRef.current.startWorld.z;
          if (Math.abs(dxWorld) > 1e-6 || Math.abs(dzWorld) > 1e-6) {
            const wallId = dragRef.current.id;
            commit((prev) => prev.map((p) => {
              if (p.id === wallId) {
                const [px, py, pz] = p.position;
                return { ...p, position: [px + dxWorld, py, pz + dzWorld] };
              }
              if (p.wallId === wallId) {
                const [px, py, pz] = p.position;
                return { ...p, position: [px + dxWorld, py, pz + dzWorld] };
              }
              return p;
            }));
          }
        }
        dragRef.current = null;
        return;
      }

      if (toolRef.current === 'wall') {
        if (!wallDraftRef.current) {
          wallDraftRef.current = { x: w.x, z: w.z };
        } else {
          const start = wallDraftRef.current;
          let dx = w.x - start.x, dz = w.z - start.z;
          if (shiftRef.current) ({ dx, dz } = snapAngle(dx, dz));
          const end = { x: start.x + dx, z: start.z + dz };
          addPart({ id: genId2D(), ...wallPartFromPoints(start, end, defaults, floor) });
          wallDraftRef.current = null;
        }
        return;
      }

      if (toolRef.current === 'door' || toolRef.current === 'window') {
        const wall = nearestWall({ x: w.rawX, z: w.rawZ });
        if (wall) addPart({ id: genId2D(), ...openingPartOnWall(wall, { x: w.rawX, z: w.rawZ }, toolRef.current, defaults) });
      }
    };

    const onWheel = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const before = screenToWorld(mx, my, viewRef.current);
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newScale = Math.max(4, Math.min(viewRef.current.scale * factor, 400));
      const view = { ...viewRef.current, scale: newScale };
      const after = worldToScreen(before.x, before.z, view);
      // Keep the point under the cursor fixed while zooming, the way every
      // real drafting tool zooms.
      viewRef.current = { ...view, originX: view.originX + (mx - after.x), originY: view.originY + (my - after.y) };
    };

    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      if (e.key === 'Shift') shiftRef.current = true;
      if (e.key === 'Escape') { wallDraftRef.current = null; onSelect(null); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdRef.current) { e.preventDefault(); deleteSelected(); }
      if (e.key === '+' || e.key === '=') { viewRef.current = { ...viewRef.current, scale: Math.min(viewRef.current.scale * 1.2, 400) }; }
      if (e.key === '-' || e.key === '_') { viewRef.current = { ...viewRef.current, scale: Math.max(viewRef.current.scale / 1.2, 4) }; }
      if (e.key === 'Home') fitToContent();

      // Tool shortcuts, matching the ArchiCAD 2D reference sheet's own keys
      // for the tools this app actually has (Wall/Door/Window). Skipped
      // when a modifier is held so they don't fight browser/OS shortcuts
      // that share the same letter (e.g. Ctrl+W closing the tab).
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'w' && setTool) setTool('wall');
        else if (k === 'd' && setTool) setTool('door');
        else if (k === 'h' && setTool) setTool('window');
        else if (k === 's' && setTool) setTool('select');
      }
      // Undo/redo — Ctrl+Z / Ctrl+Y, matching the reference sheet exactly
      // (ManualModeler has no keyboard binding for its own Undo/Redo
      // buttons yet, so this is the first place either gets one).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo && undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo && redo(); }
    };
    const onKeyUp = (e) => { if (e.key === 'Shift') shiftRef.current = false; };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, defaults, onSelect, addPart, commit, deleteSelected, setTool, undo, redo]);

  return (
    <div ref={containerRef} className="drafting2d-shell">
      <canvas ref={canvasRef} className="drafting2d-canvas" />
      <div className="drafting2d-hud">
        <label className="spec-label" style={{ marginRight: 6 }}>Grid</label>
        <select value={gridSize} onChange={(e) => setGridSize(Number(e.target.value))}>
          {GRID_SIZES.map((s) => <option key={s} value={s}>{s < 1 ? `${s * 100}cm` : `${s}m`}</option>)}
        </select>
        <button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={fitToContent}>Fit (Home)</button>
      </div>
      <div className="drafting2d-legend">
        <strong>W</strong> wall · <strong>D</strong> door · <strong>H</strong> window · <strong>S</strong> select ·{' '}
        <strong>Del</strong> delete · <strong>Ctrl+Z/Y</strong> undo/redo · <strong>Shift</strong>-drag locks angle ·{' '}
        <strong>scroll</strong> zoom · <strong>Alt/middle-drag</strong> pan
      </div>
    </div>
  );
}
