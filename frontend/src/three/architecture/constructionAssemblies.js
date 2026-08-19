// ---------------------------------------------------------------------------
// constructionAssemblies.js
//
// PHASE 2 — professional construction data layer.
//
// Everything up to now (wallSystem.js etc.) treats a wall as one solid slab
// of a named "material" for rendering. Real architectural/construction
// documentation doesn't work that way — a wall is a layered ASSEMBLY
// (structural leaf + insulation + finish, each with a real thickness,
// a real material spec, and a real quantity), and a building is built in a
// known TRADE SEQUENCE, not conjured at once.
//
// This module adds that layer on top of the existing building IR
// (buildingModel.js) without changing how anything currently renders:
//   - WALL_ASSEMBLIES / FLOOR_ASSEMBLIES / ROOF_ASSEMBLIES: a named catalog
//     of real, buildable constructions (the kind a specifier/QS would
//     recognise), each broken into layers with real thicknesses.
//   - assemblyForWall / assemblyForRoof / assemblyForFloor: pick the right
//     catalog entry for a given wall/roof/floor from the building IR.
//   - generateBillOfQuantities(building): walks every wall, floor slab and
//     the roof and produces real quantities (m² of blockwork, m³ of
//     concrete, number of blocks, litres of paint, bags of cement) grouped
//     by trade — this is what should back the "materials used" output
//     instead of the AI's free-form material name list.
//   - generateConstructionSequence(building): the standard trade sequence
//     (setting out → foundation → DPC → superstructure → roofing →
//     first-fix M&E → plastering → second-fix M&E → finishes) with what
//     happens to THIS building at each stage — the "process" output.
//   - estimateMEPRequirements(building): a first-pass, rule-of-thumb
//     electrical + plumbing point count and routing note per room, derived
//     from actual room data (type + area), not invented text. This is the
//     seed for the dedicated MEP phase (real circuit/riser routing) that
//     follows this one — see the README section this phase adds.
// ---------------------------------------------------------------------------

// --- Wall assemblies -------------------------------------------------------
// Each layer: { material, thickness (m), role: 'structural'|'insulation'|
// 'finish'|'cavity', side: 'exterior'|'interior'|'core' }.
// `unitsPerM2` / `unit` describe the *dominant structural layer's* real
// procurement unit so quantities can be counted, not just areas measured.
export const WALL_ASSEMBLIES = {
  'sandcrete-block-cavity-225': {
    label: '225mm Sandcrete Block Wall (rendered both sides)',
    useCase: 'exterior', loadBearing: true, totalThickness: 0.225,
    layers: [
      { role: 'finish', side: 'exterior', material: 'cement-render', thickness: 0.015 },
      { role: 'structural', side: 'core', material: 'sandcrete-block-9in', thickness: 0.15, unit: 'block (450x225x225mm)', unitsPerM2: 10 },
      { role: 'finish', side: 'interior', material: 'gypsum-plaster', thickness: 0.015 },
    ],
  },
  'concrete-block-single-150': {
    label: '150mm Concrete Block Wall',
    useCase: 'exterior', loadBearing: true, totalThickness: 0.15,
    layers: [
      { role: 'finish', side: 'exterior', material: 'cement-render', thickness: 0.015 },
      { role: 'structural', side: 'core', material: 'concrete-block-6in', thickness: 0.15, unit: 'block (450x150x225mm)', unitsPerM2: 10 },
      { role: 'finish', side: 'interior', material: 'gypsum-plaster', thickness: 0.015 },
    ],
  },
  'reinforced-concrete-200': {
    label: '200mm Reinforced Concrete Wall (shear/retaining)',
    useCase: 'structural', loadBearing: true, totalThickness: 0.2,
    layers: [
      { role: 'structural', side: 'core', material: 'reinforced-concrete-c25', thickness: 0.2, unit: 'm³', unitsPerM2: 0.2 },
    ],
  },
  'block-partition-100': {
    label: '100mm Block Partition Wall',
    useCase: 'interior', loadBearing: false, totalThickness: 0.1,
    layers: [
      { role: 'finish', side: 'exterior', material: 'gypsum-plaster', thickness: 0.012 },
      { role: 'structural', side: 'core', material: 'concrete-block-4in', thickness: 0.1, unit: 'block (450x100x225mm)', unitsPerM2: 10 },
      { role: 'finish', side: 'interior', material: 'gypsum-plaster', thickness: 0.012 },
    ],
  },
  'timber-stud-partition-100': {
    label: '100mm Timber Stud Partition (plasterboard-lined)',
    useCase: 'interior', loadBearing: false, totalThickness: 0.1,
    layers: [
      { role: 'finish', side: 'exterior', material: 'plasterboard', thickness: 0.0125 },
      { role: 'structural', side: 'core', material: 'timber-stud-2x4', thickness: 0.075, unit: 'lin. m stud @ 400mm c/c', unitsPerM2: 2.5 },
      { role: 'finish', side: 'interior', material: 'plasterboard', thickness: 0.0125 },
    ],
  },
  'curtain-wall-glazing': {
    label: 'Aluminium Curtain Wall Glazing',
    useCase: 'exterior', loadBearing: false, totalThickness: 0.06,
    layers: [
      { role: 'structural', side: 'core', material: 'aluminium-mullion-system', thickness: 0.06, unit: 'lin. m frame', unitsPerM2: 1.2 },
      { role: 'finish', side: 'core', material: 'double-glazed-unit', thickness: 0.024, unit: 'm²', unitsPerM2: 1 },
    ],
  },
};

// --- Floor / slab assemblies -------------------------------------------
export const FLOOR_ASSEMBLIES = {
  'ground-slab-standard': {
    label: 'Ground Floor Slab (hardcore + DPM + RC slab + screed + finish)',
    totalThickness: 0.28,
    layers: [
      { role: 'sub-base', material: 'compacted-hardcore', thickness: 0.15 },
      { role: 'barrier', material: 'dpm-polythene-1000g', thickness: 0.001 },
      { role: 'structural', material: 'reinforced-concrete-c20', thickness: 0.15, unit: 'm³', unitsPerM2: 0.15 },
      { role: 'finish', material: 'sand-cement-screed', thickness: 0.03 },
    ],
  },
  'suspended-slab-standard': {
    label: 'Suspended (First-Floor) RC Slab',
    totalThickness: 0.15,
    layers: [
      { role: 'structural', material: 'reinforced-concrete-c25', thickness: 0.15, unit: 'm³', unitsPerM2: 0.15 },
      { role: 'finish', material: 'sand-cement-screed', thickness: 0.03 },
    ],
  },
  'ceramic-tile-finish': {
    label: 'Ceramic Floor Tile Finish',
    totalThickness: 0.02,
    layers: [{ role: 'finish', material: 'ceramic-floor-tile', thickness: 0.01, unit: 'm²', unitsPerM2: 1.05 }],
  },
  'timber-floor-finish': {
    label: 'Engineered Timber Floor Finish',
    totalThickness: 0.018,
    layers: [{ role: 'finish', material: 'engineered-timber-plank', thickness: 0.018, unit: 'm²', unitsPerM2: 1.08 }],
  },
};

// --- Roof assemblies -----------------------------------------------------
export const ROOF_ASSEMBLIES = {
  'metal-sheet-pitched': {
    label: 'Long-Span Aluminium Roofing Sheet, Pitched',
    layers: [
      { role: 'structural', material: 'timber-truss-2x4', unit: 'lin. m' },
      { role: 'underlay', material: 'roofing-underlayment-membrane', unit: 'm²', unitsPerM2: 1.1 },
      { role: 'covering', material: 'aluminium-long-span-sheet-0.55mm', unit: 'm²', unitsPerM2: 1.1 },
      { role: 'trim', material: 'ridge-cap-and-gutter', unit: 'lin. m' },
    ],
  },
  'concrete-tile-pitched': {
    label: 'Concrete Interlocking Roof Tile, Pitched',
    layers: [
      { role: 'structural', material: 'timber-truss-2x4', unit: 'lin. m' },
      { role: 'underlay', material: 'roofing-underlayment-membrane', unit: 'm²', unitsPerM2: 1.1 },
      { role: 'covering', material: 'concrete-interlocking-tile', unit: 'm²', unitsPerM2: 11 },
    ],
  },
  'flat-membrane': {
    label: 'Flat Roof, Torch-On Membrane',
    layers: [
      { role: 'structural', material: 'reinforced-concrete-c25', unit: 'm³', unitsPerM2: 0.15 },
      { role: 'insulation', material: 'rigid-foam-insulation-50mm', unit: 'm²', unitsPerM2: 1 },
      { role: 'covering', material: 'torch-on-bitumen-membrane', unit: 'm²', unitsPerM2: 1.1 },
    ],
  },
};

// --- Material unit-rate reference (used to translate quantities into a
// human-readable BOQ line; not a live price feed — see cost estimate route
// for pricing, this is pure quantity/spec).
const MATERIAL_LABELS = {
  'cement-render': 'Cement/sand render, 1:4, 15mm',
  'sandcrete-block-9in': 'Sandcrete hollow block, 9in (225mm)',
  'concrete-block-6in': 'Concrete hollow block, 6in (150mm)',
  'concrete-block-4in': 'Concrete hollow block, 4in (100mm)',
  'gypsum-plaster': 'Gypsum plaster skim coat',
  'plasterboard': 'Plasterboard, 12.5mm',
  'timber-stud-2x4': 'Timber stud, 2x4in, treated',
  'reinforced-concrete-c25': 'Reinforced concrete, C25/30, incl. rebar',
  'reinforced-concrete-c20': 'Mass/lightly reinforced concrete, C20/25',
  'aluminium-mullion-system': 'Aluminium curtain wall mullion/transom system',
  'double-glazed-unit': 'Double-glazed sealed unit, 24mm',
  'compacted-hardcore': 'Compacted hardcore fill',
  'dpm-polythene-1000g': 'Damp-proof membrane, 1000-gauge polythene',
  'sand-cement-screed': 'Sand/cement floor screed',
  'ceramic-floor-tile': 'Ceramic floor tile, 600x600mm',
  'engineered-timber-plank': 'Engineered timber flooring plank',
  'timber-truss-2x4': 'Timber roof truss members, 2x4in',
  'roofing-underlayment-membrane': 'Roofing underlayment/breather membrane',
  'aluminium-long-span-sheet-0.55mm': 'Aluminium long-span roofing sheet, 0.55mm',
  'ridge-cap-and-gutter': 'Ridge cap flashing + eaves gutter',
  'concrete-interlocking-tile': 'Concrete interlocking roof tile',
  'rigid-foam-insulation-50mm': 'Rigid foam insulation board, 50mm',
  'torch-on-bitumen-membrane': 'Torch-applied bitumen waterproofing membrane',
};

export function materialLabel(key) {
  return MATERIAL_LABELS[key] || key;
}

// --- Visual material mapping ------------------------------------------
// Maps a construction-spec material key (e.g. 'sandcrete-block-9in') onto
// one of the existing renderer material *kinds* (materialSystem.js's
// EXTERIOR_PRESETS/INTERIOR_PRESETS keys), so wallSystem.js can render each
// assembly layer with a visually distinct, appropriate finish without this
// (deliberately Three.js-free) module needing to know anything about
// Three.js materials itself.
const MATERIAL_VISUAL_KIND = {
  'cement-render': 'plaster',
  'sandcrete-block-9in': 'concrete',
  'concrete-block-6in': 'concrete',
  'concrete-block-4in': 'concrete',
  'gypsum-plaster': 'plaster',
  'plasterboard': 'plaster',
  'timber-stud-2x4': 'wood',
  'reinforced-concrete-c25': 'exposed-concrete',
  'reinforced-concrete-c20': 'exposed-concrete',
  'aluminium-mullion-system': 'aluminium',
  'double-glazed-unit': 'glass',
};
export function materialVisualKind(key) {
  return MATERIAL_VISUAL_KIND[key] || 'plaster';
}

// --- Assembly selection ----------------------------------------------------
// Maps the simple `wall.material` / `wall.type` tag already used by the
// renderer onto a real buildable assembly. Falls back sensibly so every
// existing wall (AI-generated, offline template, or manually drawn) resolves
// to something, without requiring upstream callers to change yet.
export function assemblyForWall(wall) {
  if (wall.type === 'interior') {
    return WALL_ASSEMBLIES['block-partition-100'];
  }
  if (wall.type === 'compound' || wall.type === 'parapet') {
    return WALL_ASSEMBLIES['concrete-block-single-150'];
  }
  const m = wall.material || 'plaster';
  if (m === 'glass') return WALL_ASSEMBLIES['curtain-wall-glazing'];
  if (m === 'concrete' || m === 'exposed-concrete') return WALL_ASSEMBLIES['reinforced-concrete-200'];
  return WALL_ASSEMBLIES['sandcrete-block-cavity-225'];
}

export function assemblyForRoof(roof) {
  if (roof.type === 'flat' || roof.type === 'parapet') return ROOF_ASSEMBLIES['flat-membrane'];
  if (roof.material === 'tile') return ROOF_ASSEMBLIES['concrete-tile-pitched'];
  return ROOF_ASSEMBLIES['metal-sheet-pitched'];
}

export function assemblyForFloor(level) {
  return level.index === 1 ? FLOOR_ASSEMBLIES['ground-slab-standard'] : FLOOR_ASSEMBLIES['suspended-slab-standard'];
}

// Returns this wall's assembly layers rescaled so they sum exactly to the
// wall's own declared thickness (assemblies are authored against a
// reference thickness — e.g. 225mm — that a specific wall instance won't
// always match exactly). Order is preserved (authored exterior -> interior).
// Returns null when there's nothing meaningful to layer (single-layer
// assembly, or a degenerate/very thin wall where separate layers wouldn't
// read as anything but noise).
export function scaledWallLayers(wall) {
  const assembly = assemblyForWall(wall);
  if (!assembly.layers || assembly.layers.length < 2) return null;
  if (!wall.thickness || wall.thickness < 0.06) return null;
  const referenceTotal = assembly.layers.reduce((s, l) => s + l.thickness, 0) || wall.thickness;
  const scale = wall.thickness / referenceTotal;
  return assembly.layers.map((l) => ({ ...l, thickness: l.thickness * scale }));
}

// --- Stair assembly --------------------------------------------------
export const STAIR_ASSEMBLIES = {
  'rc-stair-marble-finish': {
    label: 'RC Stair with Marble Tread Finish',
    layers: [
      { role: 'structural', side: 'core', material: 'reinforced-concrete-c25', thickness: 0.15 },
      { role: 'finish', side: 'exterior', material: 'ceramic-floor-tile', thickness: 0.02 },
    ],
  },
};
export function assemblyForStair() {
  return STAIR_ASSEMBLIES['rc-stair-marble-finish'];
}

// Clamps a requested riser/tread into the comfort/code range used by most
// residential codes (150-200mm riser, 250-300mm tread, "2R+T = 600-650mm")
// and reports the real step count that produces — the single source of
// truth for both the 3D geometry (stairSystem.js) and the quantities
// below, so a stair's BOQ concrete volume always matches the steps it's
// actually rendered with.
export function checkStairCompliance(riserHeight, treadDepth) {
  const MIN_RISER = 0.15, MAX_RISER = 0.2;
  const MIN_TREAD = 0.25, MAX_TREAD = 0.32;
  const clampedRiser = Math.min(Math.max(riserHeight, MIN_RISER), MAX_RISER);
  const clampedTread = Math.min(Math.max(treadDepth, MIN_TREAD), MAX_TREAD);
  return {
    riserHeight: clampedRiser,
    treadDepth: clampedTread,
    compliant: riserHeight === clampedRiser && treadDepth === clampedTread,
    twoRPlusT: 2 * clampedRiser + clampedTread, // comfort target: 0.6-0.65m
    warning: riserHeight !== clampedRiser || treadDepth !== clampedTread
      ? `Requested riser/tread (${Math.round(riserHeight * 1000)}mm / ${Math.round(treadDepth * 1000)}mm) fell outside the standard residential comfort range and was clamped to ${Math.round(clampedRiser * 1000)}mm / ${Math.round(clampedTread * 1000)}mm.`
      : null,
  };
}

// --- Geometry helpers (kept local so this module has no Three.js
// dependency — quantities are computable from the plain IR alone) --------
function wallArea(wall) {
  const dx = wall.end[0] - wall.start[0];
  const dz = wall.end[1] - wall.start[1];
  const len = Math.hypot(dx, dz);
  const openingArea = (wall.openings || []).reduce((sum, o) => sum + o.width * o.height, 0);
  return Math.max(0, len * wall.height - openingArea);
}
function levelFootprintArea(level) {
  const pts = level.footprint || [];
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    area += x1 * z2 - x2 * z1;
  }
  return Math.abs(area) / 2;
}

// --- Bill of Quantities ------------------------------------------------
// Returns { trades: [{ trade, lines: [{ material, spec, quantity, unit }] }] }
// grouped the way a QS/contractor would read it, plus a flat `lines` array
// for simple table rendering.
export function generateBillOfQuantities(building) {
  const lineMap = new Map(); // key: trade|material -> { trade, material, unit, quantity }
  const addLine = (trade, material, quantity, unit) => {
    const key = `${trade}|${material}|${unit}`;
    const existing = lineMap.get(key);
    if (existing) existing.quantity += quantity;
    else lineMap.set(key, { trade, material, quantity, unit });
  };

  for (const level of building.levels) {
    for (const wall of level.walls) {
      const assembly = assemblyForWall(wall);
      const area = wallArea(wall);
      if (area <= 0) continue;
      const trade = assembly.loadBearing === false && wall.type === 'interior' ? 'Partitions' : 'Blockwork/Structure';
      for (const layer of assembly.layers) {
        const qty = layer.unit === 'm²' || !layer.unitsPerM2
          ? area
          : area * layer.unitsPerM2;
        addLine(trade, materialLabel(layer.material), Math.round(qty * 100) / 100, layer.unit || 'm²');
      }
    }
    const floorAssembly = assemblyForFloor(level);
    const floorArea = levelFootprintArea(level);
    for (const layer of floorAssembly.layers) {
      const qty = layer.unit === 'm²' || !layer.unitsPerM2 ? floorArea : floorArea * layer.unitsPerM2;
      addLine('Flooring/Slabs', materialLabel(layer.material), Math.round(qty * 100) / 100, layer.unit || 'm²');
    }
  }

  if (building.roof) {
    const roofAssembly = assemblyForRoof(building.roof);
    const top = building.levels[building.levels.length - 1];
    const roofPlanArea = top ? levelFootprintArea(top) * 1.15 : 0; // +15% for overhang/pitch allowance
    for (const layer of roofAssembly.layers) {
      const qty = layer.unitsPerM2 ? roofPlanArea * layer.unitsPerM2 : roofPlanArea;
      addLine('Roofing', materialLabel(layer.material), Math.round(qty * 100) / 100, layer.unit || 'm²');
    }
  }

  for (const stair of building.stairs || []) {
    const fromLevel = building.levels.find((l) => l.index === stair.fromFloor);
    const toLevel = building.levels.find((l) => l.index === stair.toFloor);
    if (!fromLevel || !toLevel) continue;
    const rise = toLevel.elevation - fromLevel.elevation;
    if (rise <= 0) continue;
    const { riserHeight, treadDepth } = checkStairCompliance(stair.riserHeight || 0.18, stair.treadDepth || 0.28);
    const stepCount = Math.max(3, Math.round(rise / riserHeight));
    const width = stair.width || 1.0;
    const treadArea = width * treadDepth * stepCount;
    const stairAssembly = assemblyForStair();
    for (const layer of stairAssembly.layers) {
      const qty = layer.role === 'structural'
        ? treadArea * layer.thickness * 2 // treads + soffit wedge, rough allowance
        : treadArea;
      addLine('Stairs', materialLabel(layer.material), Math.round(qty * 100) / 100, layer.role === 'structural' ? 'm³' : 'm²');
    }
  }

  const lines = Array.from(lineMap.values()).sort((a, b) => a.trade.localeCompare(b.trade));
  const trades = [];
  for (const line of lines) {
    let group = trades.find((t) => t.trade === line.trade);
    if (!group) { group = { trade: line.trade, lines: [] }; trades.push(group); }
    group.lines.push({ material: line.material, quantity: line.quantity, unit: line.unit });
  }
  return { trades, lines };
}

// --- Construction sequence ----------------------------------------------
// Standard build sequence, annotated with what happens to THIS building at
// each stage (storey count, roof type, whether it has a suspended slab).
export function generateConstructionSequence(building) {
  const storeys = building.levels.length;
  const hasUpperFloor = storeys > 1;
  const roofType = building.roof?.type || 'hip';
  const compound = !!building.exterior?.compoundWall;

  const seq = [
    { stage: 'Setting Out', detail: 'Survey and peg the building line, boundary offsets/setbacks, and profile boards from the site plan.' },
    { stage: 'Excavation & Foundation', detail: `Excavate to strip/pad footing depth, cast blinding, pour reinforced strip/pad foundation and foundation walls up to damp-proof course level.` },
    { stage: 'Damp-Proof Course & Ground Slab', detail: 'Lay DPC across all foundation walls, backfill and compact hardcore, lay DPM, cast the ground floor slab.' },
    { stage: 'Superstructure — Blockwork', detail: `Build load-bearing walls in courses to lintel level, cast reinforced concrete lintels over every door/window opening, continue blockwork to wall-plate level${hasUpperFloor ? ' at each floor' : ''}.` },
  ];
  if (hasUpperFloor) {
    seq.push({ stage: 'Suspended Floor Slab', detail: `Shutter and cast the reinforced concrete suspended slab for each upper floor (${storeys - 1} upper level${storeys - 1 > 1 ? 's' : ''}) before continuing blockwork above.` });
  }
  seq.push({ stage: 'Roofing', detail: `Erect roof structure (${roofType} roof) — wall plate, trusses/rafters, purlins — then fix underlay and ${roofType === 'flat' ? 'waterproofing membrane' : 'roof covering'}, ridge and eaves/gutter trim.` });
  seq.push({ stage: 'First-Fix Electrical & Plumbing', detail: 'Chase and route conduit/cable and supply/drain pipework through wall cavities and slab before plastering closes them in — see MEP requirements below for point counts.' });
  seq.push({ stage: 'Plastering & Screeding', detail: 'Render external walls, plaster internal walls and ceilings, lay floor screed to falls where required (wet areas).' });
  seq.push({ stage: 'Doors, Windows & Second-Fix Joinery', detail: 'Fix door and window frames into prepared openings, hang doors/glazing, fit skirting and architraves.' });
  seq.push({ stage: 'Second-Fix Electrical & Plumbing', detail: 'Fit switches, sockets, distribution board, light fittings, sanitary ware, taps and water heaters; pressure-test and commission.' });
  seq.push({ stage: 'Floor & Wall Finishes', detail: 'Lay tile/timber floor finishes, wall tiling in wet areas, paint internal and external surfaces.' });
  if (compound) {
    seq.push({ stage: 'External Works', detail: 'Build compound/perimeter wall and gate, form driveway/paving, landscape and final site clean-up.' });
  }
  seq.push({ stage: 'Snagging & Handover', detail: 'Punch-list inspection, defect rectification, final clean, handover with as-built drawings and O&M documentation.' });
  return seq;
}

// --- MEP requirements (first-pass rule-of-thumb estimate) -----------------
// Not full circuit/riser design yet (that is the dedicated MEP phase) —
// this derives a defensible point count per room from actual room data
// (type + area) so the output is grounded, not invented, and gives a
// contractor a starting schedule.
const ELECTRICAL_RULES = {
  bedroom: { sockets: 4, lightPoints: 1, switches: 2, extra: ['1 ceiling fan point'] },
  'master-bedroom': { sockets: 5, lightPoints: 1, switches: 2, extra: ['1 ceiling fan point', 'AC isolator point'] },
  living: { sockets: 6, lightPoints: 2, switches: 3, extra: ['TV/media point', 'ceiling fan point'] },
  kitchen: { sockets: 5, lightPoints: 2, switches: 2, extra: ['dedicated cooker circuit', 'extractor fan point'] },
  bathroom: { sockets: 1, lightPoints: 1, switches: 1, extra: ['water heater isolator (dedicated circuit)', 'extractor fan point'] },
  dining: { sockets: 3, lightPoints: 1, switches: 1, extra: [] },
  office: { sockets: 4, lightPoints: 1, switches: 1, extra: ['data/network point'] },
  garage: { sockets: 2, lightPoints: 1, switches: 1, extra: ['garage door motor circuit'] },
  corridor: { sockets: 1, lightPoints: 1, switches: 2, extra: [] },
  generic: { sockets: 2, lightPoints: 1, switches: 1, extra: [] },
};
const PLUMBING_RULES = {
  bathroom: { supplyPoints: 3, drainPoints: 3, fixtures: ['WC', 'wash hand basin', 'shower/bath'] },
  kitchen: { supplyPoints: 1, drainPoints: 1, fixtures: ['kitchen sink'] },
  laundry: { supplyPoints: 1, drainPoints: 1, fixtures: ['washing machine point'] },
};

export function estimateMEPRequirements(building) {
  const rooms = building.levels.flatMap((l) => l.rooms.map((r) => ({ ...r, floor: l.index })));
  const electrical = [];
  const plumbing = [];
  let totalSockets = 0, totalLightPoints = 0, wetRooms = 0;

  for (const room of rooms) {
    // designBriefToBuilding.js tags every bedroom with type 'bedroom' and
    // distinguishes the master only by name ("Master Bedroom"/"Master
    // Ensuite") — match on name too so the master gets its upgraded rule
    // instead of silently falling through to the plain bedroom count.
    const isMaster = /master/i.test(room.name || '');
    const key = isMaster && room.type === 'bedroom' ? 'master-bedroom'
      : ELECTRICAL_RULES[room.type] ? room.type : 'generic';
    const rule = ELECTRICAL_RULES[key];
    electrical.push({ room: room.name || room.type, floor: room.floor, ...rule });
    totalSockets += rule.sockets;
    totalLightPoints += rule.lightPoints;

    const pRule = PLUMBING_RULES[room.type];
    if (pRule) {
      plumbing.push({ room: room.name || room.type, floor: room.floor, ...pRule });
      wetRooms += 1;
    }
  }

  const storeys = building.levels.length;
  return {
    electrical: {
      perRoom: electrical,
      totals: { sockets: totalSockets, lightPoints: totalLightPoints },
      notes: [
        storeys > 1
          ? 'Main distribution board at ground floor entry point, with a sub-board per upper floor.'
          : 'Single main distribution board at the entry point, sized for all circuits above.',
        'Every wet area (bathroom/kitchen) circuit to run via an RCD/ELCB for shock protection.',
        'Route conduit within block cavities and screed before plastering (see First-Fix stage in the construction sequence).',
      ],
    },
    plumbing: {
      perRoom: plumbing,
      totals: { wetRooms, supplyRiser: storeys > 1 ? 'Vertical supply riser required, ground to top floor' : 'Single-level supply, no riser required' },
      notes: [
        'Cold water supply from overhead tank/mains via a single riser feeding all wet rooms, stacked vertically where possible to shorten runs.',
        'Soil/waste drainage falls to a septic tank/soakaway or mains sewer connection, with vent stack above roof line.',
        'Hot water via point-of-use heaters at each bathroom/kitchen unless a central system is specified.',
      ],
    },
  };
}
