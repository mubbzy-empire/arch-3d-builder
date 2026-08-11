// Renders a top-down 2D floor-plan blueprint from the same `parts` array the
// Manual Modeler edits and buildParts.js turns into 3D geometry. This is a
// pure canvas drawing (no three.js) so it can also be downloaded as a PNG or
// fed straight into the same blueprint-analysis pipeline the Upload page uses.

const PAPER = '#f4f1ea';
const INK = '#231f18';
const MUTED = '#8b8574';

// Rotates a local (length-axis, thickness-axis) offset into world (x, z)
// using the same convention the manual modeler uses when placing openings
// along a wall (see ManualModeler.jsx's door/window placement math).
function localToWorld(cx, cz, rot, lx, lz) {
  return {
    x: cx + lx * Math.cos(rot) + lz * Math.sin(rot),
    z: cz - lx * Math.sin(rot) + lz * Math.cos(rot),
  };
}

function rectCorners(cx, cz, length, thickness, rotation = 0) {
  const hl = length / 2, ht = thickness / 2;
  return [
    localToWorld(cx, cz, rotation, -hl, -ht),
    localToWorld(cx, cz, rotation, hl, -ht),
    localToWorld(cx, cz, rotation, hl, ht),
    localToWorld(cx, cz, rotation, -hl, ht),
  ];
}

function wallLocalX(wall, part) {
  const [wx, , wz] = wall.position;
  const rot = wall.rotation || 0;
  const dx = part.position[0] - wx, dz = part.position[2] - wz;
  return dx * Math.cos(rot) - dz * Math.sin(rot);
}

/**
 * Draws the blueprint onto the given canvas element. `parts` is the Manual
 * Modeler's editor.parts array. Returns summary info (room count, wall count)
 * in case the caller wants to show it alongside the image.
 */
export function drawBlueprint(canvas, parts, { title = 'Floor plan', dpr = Math.min(window.devicePixelRatio || 1, 2) } = {}) {
  const walls = parts.filter(p => p.group === 'structure');
  const openings = parts.filter(p => p.group === 'door' || p.group === 'window');
  const objects = parts.filter(p => p.group === 'object');

  // World-space bounding box across every wall's endpoints and every
  // freestanding object, so the drawing frames everything that exists.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const extend = (x, z) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); };
  walls.forEach(w => {
    const [cx, , cz] = w.position;
    rectCorners(cx, cz, w.size[0] + w.size[2], w.size[2] + 0.4, w.rotation || 0).forEach(p => extend(p.x, p.z));
  });
  objects.forEach(o => {
    const [cx, , cz] = o.position;
    const r = o.type === 'cylinder' ? Math.max(o.radiusTop ?? 0.3, o.radiusBottom ?? 0.3) : Math.max(o.size?.[0] ?? 0.6, o.size?.[2] ?? 0.6) / 2;
    extend(cx - r, cz - r); extend(cx + r, cz + r);
  });

  if (!isFinite(minX)) { minX = -3; maxX = 3; minZ = -3; maxZ = 3; }
  const worldW = Math.max(maxX - minX, 1);
  const worldD = Math.max(maxZ - minZ, 1);

  const PAD = 56;
  const cssW = canvas.clientWidth || 720;
  const cssH = canvas.clientHeight || 720;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const scale = Math.min((cssW - PAD * 2) / worldW, (cssH - PAD * 2) / worldD);
  const offX = PAD + (cssW - PAD * 2 - worldW * scale) / 2;
  const offZ = PAD + (cssH - PAD * 2 - worldD * scale) / 2;
  const toCanvas = (x, z) => [offX + (x - minX) * scale, offZ + (z - minZ) * scale];

  // Background + light guide grid
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.strokeStyle = 'rgba(120, 110, 90, 0.18)';
  ctx.lineWidth = 1;
  const gridStep = scale >= 40 ? scale : scale * Math.ceil(40 / scale);
  for (let gx = offX; gx <= cssW - PAD + 1; gx += gridStep) { ctx.beginPath(); ctx.moveTo(gx, PAD * 0.4); ctx.lineTo(gx, cssH - PAD * 0.4); ctx.stroke(); }
  for (let gz = offZ; gz <= cssH - PAD + 1; gz += gridStep) { ctx.beginPath(); ctx.moveTo(PAD * 0.4, gz); ctx.lineTo(cssW - PAD * 0.4, gz); ctx.stroke(); }

  const fillPoly = (pts, style) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  };

  // 1) Walls, solid fill
  walls.forEach(w => {
    const [cx, , cz] = w.position;
    const corners = rectCorners(cx, cz, w.size[0], w.size[2], w.rotation || 0).map(p => toCanvas(p.x, p.z));
    fillPoly(corners, INK);
  });

  // 2) Cut door/window gaps out of the walls they belong to, then draw symbols
  openings.forEach(op => {
    const wall = walls.find(w => w.id === op.wallId);
    if (!wall) return;
    const [cx, , cz] = wall.position;
    const rot = wall.rotation || 0;
    const gapCorners = rectCorners(op.position[0], op.position[2], op.size[0], wall.size[2] + 0.02, rot).map(p => toCanvas(p.x, p.z));
    fillPoly(gapCorners, PAPER);

    const localX = wallLocalX(wall, op);
    const hingeSign = localX >= 0 ? -1 : 1; // just to vary which side the swing/tick sits on
    const p0 = localToWorld(op.position[0], op.position[2], rot, hingeSign * op.size[0] / 2, 0);
    const [hx, hy] = toCanvas(p0.x, p0.z);
    const radiusPx = (op.size[0]) * scale;

    if (op.group === 'door') {
      // Door leaf (straight line from hinge) + a quarter-circle swing arc.
      const leafEnd = localToWorld(op.position[0], op.position[2], rot, hingeSign * op.size[0] / 2, hingeSign * op.size[0]);
      const [lx2, ly2] = toCanvas(leafEnd.x, leafEnd.z);
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, scale * 0.03);
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(lx2, ly2); ctx.stroke();
      const startAngle = Math.atan2(ly2 - hy, lx2 - hx);
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(hx, hy, radiusPx, startAngle, startAngle - hingeSign * Math.PI / 2, hingeSign > 0);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // Window: a thin double tick across the gap.
      const a = localToWorld(op.position[0], op.position[2], rot, -op.size[0] / 2, 0);
      const b = localToWorld(op.position[0], op.position[2], rot, op.size[0] / 2, 0);
      const [ax, ay] = toCanvas(a.x, a.z), [bx, by] = toCanvas(b.x, b.z);
      const nx = -(by - ay), nz = bx - ax;
      const len = Math.hypot(nx, nz) || 1;
      const off = (wall.size[2] * scale) / 3;
      [1, -1].forEach(sign => {
        ctx.strokeStyle = '#4a6b8a';
        ctx.lineWidth = Math.max(1, scale * 0.02);
        ctx.beginPath();
        ctx.moveTo(ax + (nx / len) * off * sign, ay + (nz / len) * off * sign);
        ctx.lineTo(bx + (nx / len) * off * sign, by + (nz / len) * off * sign);
        ctx.stroke();
      });
    }
  });

  // 3) Wall length dimension labels
  ctx.font = '11px monospace';
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  walls.forEach(w => {
    const [cx, , cz] = w.position;
    const rot = w.rotation || 0;
    const labelPt = localToWorld(cx, cz, rot, 0, w.size[2] / 2 + 0.35);
    const [lx, ly] = toCanvas(labelPt.x, labelPt.z);
    ctx.fillText(`${w.size[0].toFixed(2)} m`, lx, ly);
  });

  // 4) Freestanding objects (light dashed outline, top view)
  objects.forEach(o => {
    const [cx, , cz] = o.position;
    ctx.strokeStyle = MUTED;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    if (o.type === 'cylinder') {
      const r = Math.max(o.radiusTop ?? 0.3, o.radiusBottom ?? 0.3) * scale;
      const [x, y] = toCanvas(cx, cz);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    } else if (o.size) {
      const corners = rectCorners(cx, cz, o.size[0], o.size[2], o.rotation || 0).map(p => toCanvas(p.x, p.z));
      ctx.beginPath();
      corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath(); ctx.stroke();
    }
    ctx.setLineDash([]);
  });

  // Title, scale bar, north arrow
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(title, PAD * 0.4, PAD * 0.6);

  const barM = worldW > 20 ? 5 : 1;
  const barPx = barM * scale;
  const barX = cssW - PAD * 0.4 - barPx, barY = cssH - PAD * 0.45;
  ctx.strokeStyle = INK; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(barX, barY); ctx.lineTo(barX + barPx, barY); ctx.stroke();
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${barM} m`, barX + barPx / 2, barY - 6);

  ctx.textAlign = 'left';
  ctx.font = '10px monospace';
  ctx.fillStyle = MUTED;
  ctx.fillText('N ↑', PAD * 0.4, cssH - PAD * 0.45);

  return {
    wallCount: walls.length,
    doorCount: openings.filter(o => o.group === 'door').length,
    windowCount: openings.filter(o => o.group === 'window').length,
    objectCount: objects.length,
  };
}

export function blueprintToBlob(parts, opts = {}) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.style.width = `${opts.width || 900}px`;
    canvas.style.height = `${opts.height || 900}px`;
    // clientWidth/clientHeight only resolve for canvases attached to the DOM,
    // so size this off-screen canvas from explicit width/height instead.
    Object.defineProperty(canvas, 'clientWidth', { value: opts.width || 900 });
    Object.defineProperty(canvas, 'clientHeight', { value: opts.height || 900 });
    drawBlueprint(canvas, parts, opts);
    canvas.toBlob((blob) => resolve(blob), 'image/png', 0.95);
  });
}
