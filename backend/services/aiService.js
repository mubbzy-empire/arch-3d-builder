/**
 * AI service for Arch-3d build.
 *
 * If GEMINI_API_KEY is set (free tier key from https://aistudio.google.com/apikey),
 * requests go to Google's Gemini API for real vision + language analysis,
 * photorealistic rendering, and cost estimation.
 *
 * If no key is configured, everything falls back to OFFLINE_ENGINE: a
 * deterministic, rule-based system that still returns a complete, usable
 * result so the app is fully functional with zero setup and zero cost.
 */

const { GoogleGenAI } = require('@google/genai');
const { planEstate } = require('./estatePlanner.js');

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
// Note: Google retires/renames Gemini models often. If any model below ever
// 404s, check https://ai.google.dev/gemini-api/docs/models for the current
// free-tier model names and update here — the offline engine keeps the app
// working in the meantime either way.
const TEXT_MODEL = 'gemini-3.1-flash-lite';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

const genAI = GEMINI_KEY ? new GoogleGenAI({ apiKey: GEMINI_KEY }) : null;

// ---------------------------------------------------------------------------
// Shared JSON contract for a buildable design (blueprint analysis and chat
// design both produce this same shape, with mode-specific instructions).
// ---------------------------------------------------------------------------
function schemaInstructions() {
  return `
Respond with ONLY valid JSON (no markdown fences, no commentary) matching exactly this shape:
{
  "title": "short project name",
  "category": "one of: house | table | shelving | seating | cabinet | outdoor-structure | frame | generic",
  "summary": "2-3 sentence plain-language description of the design",
  "dimensions": [ {"label": "Height", "value": "5.0 m"}, {"label": "Width", "value": "10.0 m"}, {"label": "Depth", "value": "8.0 m"} ],
  "materials": [ {"name": "Fiber-cement siding", "purpose": "exterior cladding" }, ... 4-8 items ],
  "equipment": [ {"name": "Framing nailer", "note": "wall assembly"}, ... 4-8 items ],
  "steps": [ "short build step 1", "short build step 2", ... 4-6 items ],
  "modelSpec": {
    "parts": [
      {"type":"box","size":[width,height,depth],"position":[x,y,z],"material":"wood|metal|glass|fabric","color":"#hexcode (optional)","group":"structure|roof|window|door|interior|interior-door|balcony|pool","floor":1,"room":"optional short room name e.g. 'Parlor'"},
      {"type":"cylinder","radiusTop":r,"radiusBottom":r,"height":h,"position":[x,y,z],"material":"wood|metal|glass|fabric","color":"#hexcode (optional)","group":"structure|roof|window|door|interior","floor":1,"room":"optional short room name"}
    ]
  }
}
Every part needs a "group" tag:
- "structure": the building envelope. Its own "material" must be "wood", "metal", or "fabric" — NEVER "glass", even for designs described as glassy/floor-to-ceiling windows (represent that with more/larger "window" parts instead; a glass envelope makes the whole building see-through, which is wrong). If the building is a SINGLE story, exactly ONE box for the whole envelope. If it has MULTIPLE stories/floors (e.g. described as two-story, a duplex, a penthouse atop other floors, an apartment building), create ONE separate structure box PER FLOOR, each stacked directly on top of the one below and each tagged with its own "floor" number (1 = ground floor, 2 = next floor up, etc.) — the viewer turns each floor's envelope into its own real hollow walls with door/window cutouts, automatically adds a string-course trim band at every floor line above the ground floor and a plinth at the base, and makes each floor independently selectable and draggable so a person can pull one floor away to inspect the others. Every floor needs its own full room layout (not just the ground floor) — a two-story building with an identical, undecorated box repeated on top is a failing response; give the upper floor(s) their own window rhythm, at least one balcony (see below), and, where it suits the brief, a slightly smaller footprint than the floor below so the massing doesn't read as one plain stacked block. Never add separate wall boxes alongside a structure envelope — the viewer builds the walls automatically from it.
- "roof": roof/lid/top-cover geometry on the topmost floor, its own separate part(s) so it can be toggled off. Make it overhang the walls below by roughly 0.3-0.5m on every side (a roof that stops exactly at the wall line looks unfinished) and give it real pitch/height relative to the building's footprint rather than a flat lid, unless the brief specifically calls for a flat/modern roof. It is shown by default — the interior is only revealed when the person taps "Show interior" in the viewer, so never rely on the roof being hidden to make rooms visible.
- "window": becomes a REAL cut-through opening with glass filling it, and the viewer automatically adds a frame, mullions, and a sill — you only need to size and place the glazed opening itself. Width ~0.9-1.5m, height ~1-1.4m. At least 3-5 per floor across different walls for a house, and vary sizes/placement between floors of the same building rather than repeating an identical grid on every level. Tag with the matching "floor" number of the wall it belongs to.
- "door": becomes a REAL cut-through opening with a door panel filling it, and the viewer automatically adds a frame, threshold, and handle. ~0.8-1.0m wide, ~2.0-2.1m tall, base at y=0 relative to its floor. At least one exterior door on the ground floor. On upper floors, a wider (~1.5-1.8m) glazed door (material "glass") leading onto a balcony reads well for a duplex/multi-story design. If the brief mentions a GARAGE, add a "door" opening ~2.4-3.0m wide × ~2.1m tall on the ground floor where the garage should be — the viewer automatically detects any door that wide and dresses it as a sectional garage door (panel lines, no handle) instead of a house door, so you don't need a separate part type for it; still give the garage its own room-tagged "interior" bay (room: "Garage") the way any other room would be enclosed. Tag with the matching "floor" number.
- "pool": ONLY when the brief mentions a swimming pool. "size": [width, waterDepth, length] where waterDepth is how far the basin sinks below ground (~1.2-1.5m typical), "position" is the deck-rim center at ground level (y≈0), placed a few meters clear of the building footprint so it doesn't overlap the walls. The viewer automatically builds the coping/deck, tiled basin, and water surface — you only provide this one part. Do not add a pool unless one was actually requested.
- "balcony": a projecting platform with a railing (the viewer builds the railing/balusters automatically — you only provide the slab). Use "size": [width, 0.1, depth] where width runs along the wall and depth is how far it projects outward, "position" is the slab's floor level centered on the wall it projects from, and "rotation" (radians, optional, default 0 = projects toward +Z) should match whichever exterior wall it's attached to. Any 2+ story house or duplex should have at least one balcony on an upper floor — this is one of the most distinctive features of a good multi-story design, don't skip it.
- "interior": a floor slab per story, PLUS mandatory partition walls that physically divide the floor into distinct enclosed rooms — this is the single most important part of a good response, do not skip or minimize it. Plan it like a real floor plan, not a grid: cluster the living/parlor and kitchen near the entry door (sized unevenly — living space larger, kitchen smaller — not equal boxes), then run a hallway/corridor back from there with the bedrooms and bathroom/toilet opening directly off that hallway, each in its own room, the bathroom noticeably smaller than the bedrooms. Do NOT produce a small number of straight walls that run the full width or full depth of the building and slice it into a uniform column/row grid of equal cells — that is not how real houses are partitioned and is a failing response even if every resulting cell is enclosed. Real houses also rarely connect rooms in a single chain (room A only reachable through room B only reachable through room C) — a shared hallway that most rooms open onto directly is the realistic pattern. First mentally list the rooms this floor needs (a home needs, at minimum: one living/parlor room, one kitchen, one bathroom/toilet, and one bedroom per bedroom described — plus a dining area, garage, or terrace if mentioned), then output real partition wall boxes that physically separate every one of those rooms from its neighbors (walls on at least 2-3 sides per room, not a single line down the middle). A floor with fewer than (room count − 1) × 2 partition wall parts is not acceptable. Tag each with the "room" it belongs to (e.g. "Parlor", "Kitchen", "Hallway", "Toilet", "Bedroom 1", "Garage") and the correct "floor". Do NOT populate rooms with furniture or decor — this application models architecture only (walls, openings, floors, roof); leave every room as clean, empty, correctly-proportioned floor space. Do not use a "furniture" group at all.
- "interior-door": a REAL cut-through doorway (with frame, threshold, and handle added automatically, same as an exterior door) inside a partition wall, so a person can actually walk from one demarcated room into the next — a floor plan where every room is sealed off with no way to reach it is a failing response. For every partition wall you add, place at least one "interior-door" roughly 0.8-0.9m wide and ~2.0m tall wherever that wall's two adjoining rooms should connect (or connect to a hallway/entry); a small home needs several of these, not just one. Position and size it exactly like an exterior "door" — the engine automatically finds and cuts it into whichever partition wall it's touching, so you don't need to reference the wall directly, just place it in the doorway location. Tag with the correct "floor".
The optional "color" field is a specific hex color (e.g. "#3a5f7d") you choose because it suits the design — used instead of the generic material default. Vary it thoughtfully across parts for a designed, non-monotone look — for a multi-story building, giving the upper floor(s) a slightly different tone than the ground floor (a common real-world cue) reads much better than one flat color top to bottom. Unless the brief asks for something else, favor a confident two-tone exterior scheme like real finished elevations use: a light-to-mid body color (e.g. sky blue "#8fc4e0", soft green, warm cream) on the main "structure" envelope, with door/entry-adjacent wall sections in a noticeably deeper shade of the same family (e.g. "#3f6fa0" alongside "#8fc4e0") rather than every wall face sharing one flat color. The viewer automatically adds dark banded corner pilasters, a roof fascia, a base plinth, and (in the site view) a perimeter compound wall with a gate to every building, so do NOT add your own corner posts, boundary walls, or fences as parts — focus color and massing choices on the building itself. Never use gradients — one flat, considered color per part.
Never represent the object as a single primitive. Break every object into the distinct parts a builder would actually assemble. Buildings must include one "structure" envelope per floor, a "roof" group, several "window" openings, at least one "door" opening, genuinely room-planned "interior" parts with connecting "interior-door" openings as described above, and (for anything 2+ stories) at least one "balcony" — never a single flat-topped box, and never a single undivided open interior for anything larger than a one-room structure. A response that just adds one or two stray divider walls without enclosing real, separate, named, DOOR-CONNECTED rooms is a failing response — plan the full room layout, including how each room is entered, before writing the parts list.
Keep "parts" between 3 and 65 primitives (multi-room, multi-story buildings need the higher end — a real house routinely needs 25-45+ parts once every room is properly walled and connected with doorways) using meters, centered around x=0, resting on y=0 upward, with floor 1 starting at y=0 and each additional floor stacked directly on top of the one below.
`.trim();
}

// ---------------------------------------------------------------------------
// Deterministic safety net: if the model still returns a sparse, barely
// partitioned interior despite the instructions above (smaller/faster free
// models sometimes under-deliver on complex structured output), fill in a
// real front-zone/hallway/bedroom-bay floor plan (see buildRealisticFloorPlan
// below) so the viewer always shows a house-shaped room layout rather than
// one open box — or a uniform grid of equal cells, which doesn't look like
// a real floor plan either. This app models architecture only — clean,
// empty, correctly-proportioned rooms — never furniture/decor. Only runs
// for live Gemini output (never touches the hand-authored offline
// templates), and only adds to floors the AI left essentially unplanned.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Every door/window opening is authored by the model as a small box "cut"
// into some wall face of its floor's envelope. Smaller/faster models
// routinely get the face-snap wrong — an opening a few centimeters off the
// wall plane, or past a corner — which either fails to cut cleanly or reads
// as a window floating in space / a door that clips through a corner. This
// snaps every opening's thin (thickness) axis exactly onto the nearest
// envelope face and clamps its position along the wall so it can never run
// past a corner, without touching its size or which wall it was meant for.
// ---------------------------------------------------------------------------
function clampOpeningsToWalls(spec) {
  const structureParts = spec.parts.filter(p => p.group === 'structure');
  const openings = spec.parts.filter(p => p.group === 'door' || p.group === 'window');
  if (!structureParts.length || !openings.length) return;

  const floors = [...new Set(structureParts.map(p => p.floor ?? 1))];
  floors.forEach(floorNum => {
    const envelope = structureParts.find(p => (p.floor ?? 1) === floorNum);
    if (!envelope || !envelope.size) return;
    const [ew, eh, ed] = envelope.size;
    const [ecx, ecy, ecz] = envelope.position || [0, eh / 2, 0];
    const baseY = ecy - eh / 2;
    const faceOffset = Math.min(0.25, Math.max(0.06, Math.min(ew, ed) * 0.02)) * 0.3 + 0.02;

    openings.filter(p => (p.floor ?? 1) === floorNum).forEach(op => {
      const [ow, oh, od] = op.size || [0.9, 1.2, 0.05];
      let [x, y, z] = op.position || [ecx, baseY + oh / 2, ecz];
      // Whichever local axis is thinner is the wall-thickness axis, so the
      // OTHER axis is the one that must stay inside the footprint.
      if (od <= ow) {
        // Thin along Z → sits on a front/back (Z-facing) wall.
        const margin = ow / 2 + 0.15;
        const span = Math.max(margin, ew / 2 - margin);
        z = (z - ecz >= 0 ? 1 : -1) * (ed / 2 + faceOffset);
        x = Math.max(ecx - span, Math.min(ecx + span, x));
      } else {
        // Thin along X → sits on a side (X-facing) wall.
        const margin = od / 2 + 0.15;
        const span = Math.max(margin, ed / 2 - margin);
        x = (x - ecx >= 0 ? 1 : -1) * (ew / 2 + faceOffset);
        z = Math.max(ecz - span, Math.min(ecz + span, z));
      }
      // Keep the opening fully between the floor and just under the ceiling.
      const botLimit = baseY + 0.05 + oh / 2;
      const topLimit = baseY + eh - 0.12 - oh / 2;
      y = Math.max(botLimit, Math.min(Math.max(botLimit, topLimit), y));
      op.position = [x, y, z];
    });
  });
}

// ---------------------------------------------------------------------------
// A building with no roof part on its topmost floor has nothing to hide the
// interior behind — the person sees fully-furnished-looking rooms the
// instant the model loads, before ever touching "Show interior". Smaller/
// faster models sometimes drop the roof entirely on more unusual briefs
// (e.g. a "penthouse" floor). This guarantees at least a simple hip roof
// sized to that floor's real footprint whenever one is missing.
// ---------------------------------------------------------------------------
function ensureRoof(spec) {
  const structureParts = spec.parts.filter(p => p.group === 'structure');
  if (!structureParts.length) return;
  const floors = [...new Set(structureParts.map(p => p.floor ?? 1))];
  const topFloor = Math.max(...floors);
  const hasTopRoof = spec.parts.some(p => p.group === 'roof' && (p.floor ?? topFloor) === topFloor);
  if (hasTopRoof) return;

  const envelope = structureParts.find(p => (p.floor ?? 1) === topFloor);
  if (!envelope || !envelope.size) return;
  const [ew, , ed] = envelope.size;
  const [ecx, , ecz] = envelope.position || [0, 0, 0];
  spec.parts.push({
    type: 'cylinder',
    radiusTop: 0.001,
    radiusBottom: Math.max(ew, ed) * 0.6,
    height: Math.max(0.9, Math.min(ew, ed) * 0.22),
    position: [ecx, 0, ecz],
    material: 'metal',
    color: '#4d4232',
    group: 'roof',
    floor: topFloor,
  });
}

// ---------------------------------------------------------------------------
// A floor with almost no windows, or a ground floor with no exterior door,
// still needs to read as a real building rather than a blank box. Tops up
// each floor to a minimum of 3 windows spread across different walls, and
// guarantees one front door on the lowest floor, only adding what's missing
// — never touches a floor that already has enough.
// ---------------------------------------------------------------------------
function ensureMinimumOpenings(spec) {
  const structureParts = spec.parts.filter(p => p.group === 'structure');
  if (!structureParts.length) return;
  const floors = [...new Set(structureParts.map(p => p.floor ?? 1))].sort((a, b) => a - b);
  const groundFloor = floors[0];

  floors.forEach(floorNum => {
    const envelope = structureParts.find(p => (p.floor ?? 1) === floorNum);
    if (!envelope || !envelope.size) return;
    const [ew, eh, ed] = envelope.size;
    const [ecx, ecy, ecz] = envelope.position || [0, eh / 2, 0];
    const baseY = ecy - eh / 2;
    const winY = baseY + eh * 0.55;

    const floorWindows = spec.parts.filter(p => p.group === 'window' && (p.floor ?? 1) === floorNum);
    const floorDoors = spec.parts.filter(p => p.group === 'door' && (p.floor ?? 1) === floorNum);

    if (floorWindows.length < 3) {
      const ww = Math.min(1.2, ew * 0.12);
      const wh = Math.min(1.2, eh * 0.35);
      const anchors = [
        { x: ecx - ew * 0.22, z: ecz + ed / 2 + 0.02, axis: 'z' },
        { x: ecx + ew * 0.22, z: ecz + ed / 2 + 0.02, axis: 'z' },
        { x: ecx - ew / 2 - 0.02, z: ecz - ed * 0.2, axis: 'x' },
        { x: ecx + ew / 2 + 0.02, z: ecz + ed * 0.2, axis: 'x' },
      ];
      for (let i = 0; floorWindows.length + i < 3 && i < anchors.length; i++) {
        const a = anchors[i];
        const size = a.axis === 'z' ? [ww, wh, 0.05] : [0.05, wh, ww];
        spec.parts.push({ type: 'box', size, position: [a.x, winY, a.z], material: 'glass', group: 'window', floor: floorNum });
      }
    }

    if (floorNum === groundFloor && floorDoors.length === 0) {
      const dh = Math.min(2.05, eh * 0.7);
      spec.parts.push({
        type: 'box', size: [0.9, dh, 0.05],
        position: [ecx, baseY + dh / 2, ecz + ed / 2 + 0.02],
        material: 'wood', color: '#6b4a2f', group: 'door', floor: floorNum,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// A real house isn't a grid: living spaces cluster near the entry, bedrooms
// share a hallway instead of opening directly into each other, and the
// bath is a small room tucked at the end of that hallway, not a slice the
// same size as everything else. This builds that shape — front zone
// (parlor + kitchen, split unevenly, entered from the door) / spine wall
// with one hallway doorway / back zone (a corridor with bedrooms and one
// bath opening off it) — instead of dividing the whole footprint into a
// uniform column/row grid.
//
// Coordinates are worked out in a local (u, v) frame — u runs from the
// entry door towards the back of the house, v runs across it — then mapped
// back to world x/z at the end, so the same logic works whether the real
// entry sits on an x-facing or z-facing wall.
// ---------------------------------------------------------------------------
function buildRealisticFloorPlan(spec, floorNum, envelope) {
  const [w, h, d] = envelope.size;
  const [cx, cy, cz] = envelope.position || [0, h / 2, 0];
  const baseY = cy - h / 2;
  const thickness = 0.08;
  const wallH = Math.max(0.4, h - 0.2);
  const wallY = baseY + wallH / 2;

  const entryDoor = spec.parts.find(p => (p.floor ?? 1) === floorNum && p.group === 'door' && (p.size?.[0] ?? 1) < 2.2)
    || spec.parts.find(p => (p.floor ?? 1) === floorNum && p.group === 'door');
  const [dx0, , dz0] = entryDoor?.position || [cx, 0, cz - d / 2];
  const distToXFaces = Math.min(Math.abs(dx0 - (cx - w / 2)), Math.abs(dx0 - (cx + w / 2)));
  const distToZFaces = Math.min(Math.abs(dz0 - (cz - d / 2)), Math.abs(dz0 - (cz + d / 2)));
  const frontAxis = distToZFaces <= distToXFaces ? 'z' : 'x';

  const alongExtent = frontAxis === 'z' ? d : w;
  const crossExtent = frontAxis === 'z' ? w : d;
  const alongCenter = frontAxis === 'z' ? cz : cx;
  const crossCenter = frontAxis === 'z' ? cx : cz;
  const alongMin = alongCenter - alongExtent / 2;
  const alongMax = alongCenter + alongExtent / 2;
  const crossMin = crossCenter - crossExtent / 2;
  const crossMax = crossCenter + crossExtent / 2;

  const doorAlong = frontAxis === 'z' ? dz0 : dx0;
  const frontAtMin = Math.abs(doorAlong - alongMin) <= Math.abs(doorAlong - alongMax);
  const frontU = frontAtMin ? alongMin : alongMax;
  const backU = frontAtMin ? alongMax : alongMin;
  const dir = frontAtMin ? 1 : -1;

  const mapUV = (u, v) => (frontAxis === 'z' ? [v, u] : [u, v]);
  const mapSize = (alongLen, crossLen) => (frontAxis === 'z' ? [crossLen, alongLen] : [alongLen, crossLen]);

  // kind 'U' = a wall at a fixed along-coordinate spanning across the cross
  // axis (separates front from back, or one bay-room from the next).
  // kind 'V' = a wall at a fixed cross-coordinate spanning along the along
  // axis (separates parlor from kitchen, or a bay from the corridor).
  const pushWall = (kind, fixedCoord, spanFrom, spanTo) => {
    const spanLen = Math.max(0.3, Math.abs(spanTo - spanFrom));
    const spanMid = (spanFrom + spanTo) / 2;
    const size3 = kind === 'U' ? mapSize(thickness, spanLen) : mapSize(spanLen, thickness);
    const [x, z] = kind === 'U' ? mapUV(fixedCoord, spanMid) : mapUV(spanMid, fixedCoord);
    spec.parts.push({ type: 'box', size: [size3[0], wallH, size3[1]], position: [x, wallY, z], material: 'wood', color: '#eef0ea', group: 'interior', room: 'auto', floor: floorNum });
  };
  const pushDoor = (kind, fixedCoord, atCoord) => {
    const size3 = kind === 'U' ? mapSize(thickness * 3, 0.85) : mapSize(0.85, thickness * 3);
    const [x, z] = kind === 'U' ? mapUV(fixedCoord, atCoord) : mapUV(atCoord, fixedCoord);
    spec.parts.push({ type: 'box', size: [size3[0], 2.0, size3[1]], position: [x, baseY + 1.0, z], material: 'wood', color: '#6b4a2f', group: 'interior-door', floor: floorNum });
  };

  const frontDepth = Math.max(2.2, Math.min(alongExtent * 0.4, alongExtent - 2.4, 4.6));
  const uBoundary = frontU + dir * frontDepth;
  const vSplit = crossMin + crossExtent * 0.62; // parlor gets the larger share

  // Spine wall between the entry-facing living zone and the bedroom zone.
  pushWall('U', uBoundary, crossMin, crossMax);

  // Parlor | Kitchen — an open relationship near the entry, not two equal
  // boxes: real small houses put these side by side with the living room
  // noticeably larger.
  pushWall('V', vSplit, frontU, uBoundary);
  pushDoor('V', vSplit, frontU + dir * frontDepth * 0.3);

  const area = w * d;
  const bedroomCount = area > 70 ? 3 : area > 40 ? 2 : 1;
  const backDepth = Math.abs(backU - uBoundary);

  if (bedroomCount <= 1 || backDepth < 3.4 || crossExtent < 4.2) {
    // Too small for a hallway to make sense — one bedroom and one bath
    // split straight off the back of the living zone, each with their own
    // door, the way a small cottage actually does it.
    const bathShare = 0.34;
    const vBath = crossMin + crossExtent * bathShare;
    pushWall('V', vBath, uBoundary, backU);
    pushDoor('U', uBoundary, crossMin + crossExtent * bathShare * 0.5);
    pushDoor('U', uBoundary, crossMin + crossExtent * (bathShare + (1 - bathShare) * 0.5));
    return;
  }

  // Hallway plan: bedrooms and the bath open off a shared corridor reached
  // through the spine doorway, in bays either side — never chained directly
  // room-to-room.
  const corridorWidth = Math.max(1.0, Math.min(1.35, crossExtent * 0.16));
  const vCorrLo = crossCenter - corridorWidth / 2;
  const vCorrHi = crossCenter + corridorWidth / 2;
  pushDoor('U', uBoundary, crossCenter);
  pushWall('V', vCorrLo, uBoundary, backU);
  pushWall('V', vCorrHi, uBoundary, backU);

  const leftCount = Math.ceil(bedroomCount / 2);
  const rightCount = bedroomCount - leftCount;
  const bathBayIdx = rightCount > 0 ? 1 : 0; // bath goes wherever there's a spare slot
  const bays = [
    { vFrom: crossMin, vTo: vCorrLo, corridorV: vCorrLo, count: leftCount, hasBath: bathBayIdx === 0 },
    { vFrom: vCorrHi, vTo: crossMax, corridorV: vCorrHi, count: rightCount, hasBath: bathBayIdx === 1 },
  ];

  bays.forEach(bay => {
    const rooms = bay.count + (bay.hasBath ? 1 : 0);
    if (rooms === 0) return;
    const bathDepth = bay.hasBath ? Math.min(2.0, Math.max(1.4, backDepth * 0.24)) : 0;
    const bedroomSpan = Math.max(0, backDepth - bathDepth);
    const bedroomDepth = bay.count > 0 ? bedroomSpan / bay.count : 0;
    const order = [...Array(bay.count).fill('bed'), ...(bay.hasBath ? ['bath'] : [])];
    let uCursor = uBoundary;
    order.forEach((kind, i) => {
      const segDepth = kind === 'bath' ? bathDepth : bedroomDepth;
      if (i > 0) pushWall('U', uCursor, bay.vFrom, bay.vTo);
      pushDoor('V', bay.corridorV, uCursor + dir * segDepth * 0.5);
      uCursor += dir * segDepth;
    });
  });
}

// Same wall-shaped-vs-slab-shaped test the frontend renderer uses (kept as
// a standalone copy here since this file has no THREE.js/frontend access) —
// tall and thin reads as a partition wall, flat reads as a floor slab.
function isWallShapedInterior(p) {
  const [w, h, d] = p.size || [0, 0, 0];
  return h > 1.2 && Math.max(w, d) > 0.5 && Math.min(w, d) < 0.3;
}

function reinforceDesign(result) {
  const spec = result?.modelSpec;
  if (!spec || !Array.isArray(spec.parts) || !spec.parts.length) return result;

  // Belt-and-suspenders: never let the envelope itself be glass, even if
  // the prompt instruction above gets ignored. Also strip any "furniture"
  // group the model might still emit — this app is architecture-only.
  spec.parts = spec.parts.filter(p => p.group !== 'furniture');
  spec.parts.forEach(p => {
    if (p.group === 'structure' && p.material === 'glass') p.material = 'wood';
  });

  const isBuildingLike = spec.parts.some(p => p.group === 'door' || p.group === 'window');
  if (!isBuildingLike) return result;

  // Fix up whatever openings the model did supply — snapped onto real wall
  // faces and kept clear of corners — before topping up any that are missing
  // and guaranteeing a roof, all ahead of the interior-partition fallback
  // below so partition walls are planned against the final envelope set.
  clampOpeningsToWalls(spec);
  ensureMinimumOpenings(spec);
  ensureRoof(spec);

  const floors = [...new Set(spec.parts.filter(p => p.group === 'structure').map(p => p.floor ?? 1))];
  let addedAny = false;

  floors.forEach(floorNum => {
    const envelope = spec.parts.find(p => p.group === 'structure' && (p.floor ?? 1) === floorNum);
    if (!envelope || !envelope.size) return;

    const existingRooms = new Set(
      spec.parts.filter(p => (p.floor ?? 1) === floorNum && p.group === 'interior' && p.room).map(p => p.room)
    );
    // Room *names* alone aren't proof of a real layout — a sparse response
    // can tag three room names onto one or two walls that don't actually
    // enclose anything (exactly what let an under-detailed live-AI result
    // slip past this check with almost no partitioning at all). Also
    // require enough actual wall-shaped interior parts to plausibly enclose
    // that many rooms, using the same (rooms − 1) × 2 bar the prompt itself
    // asks the model to meet.
    const partitionWallCount = spec.parts.filter(p => (p.floor ?? 1) === floorNum && p.group === 'interior' && isWallShapedInterior(p)).length;
    // Roughly one dividing wall per named room is the realistic ballpark
    // once shared walls are accounted for — strict enough to catch a
    // sparse response that tags several room names onto one or two walls
    // (exactly what let an under-partitioned result slip through before),
    // without discarding a genuinely reasonable AI-authored layout.
    const enoughWalls = partitionWallCount >= existingRooms.size;
    if (existingRooms.size >= 3 && enoughWalls) return; // AI already planned a real, enclosed layout for this floor — leave it alone

    // Discard whatever partial partitioning the AI did attempt for this
    // floor (walls + their doors) before rebuilding — layering a full
    // layout on top of a sparse, incomplete one would leave two competing,
    // overlapping wall schemes instead of one coherent plan. The floor slab
    // itself (not wall-shaped) is left alone.
    spec.parts = spec.parts.filter(p => !(
      (p.floor ?? 1) === floorNum
      && (p.group === 'interior-door' || (p.group === 'interior' && isWallShapedInterior(p)))
    ));

    buildRealisticFloorPlan(spec, floorNum, envelope);
    addedAny = true;
  });

  if (addedAny) {
    result.summary = `${result.summary || ''} (Room layout supplemented by Arch-3d build's fallback partitioning where the AI response was under-detailed.)`.trim();
  }
  return result;
}

async function callGemini(parts, { json = true } = {}) {
  if (!genAI) throw new Error('No Gemini API key configured');
  const response = await genAI.models.generateContent({
    model: TEXT_MODEL,
    contents: [{ role: 'user', parts }],
    config: json ? { temperature: 0.5, responseMimeType: 'application/json' } : { temperature: 0.3 },
  });
  return response.text || '';
}

function stripFences(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

// ---------------------------------------------------------------------------
// Blueprint reading, stage 1: look at the drawing and say what's actually on
// it — before any 3D geometry gets generated. This is a separate Gemini call
// from geometry generation on purpose: asking the model to identify rooms,
// walls, doors, and windows as its own discrete task (rather than folding
// "read the drawing" and "invent 3D coordinates" into one prompt) makes it
// actually look at the image instead of pattern-matching to a generic house,
// and gives the person a legible record of what the AI recognized — which
// they can sanity-check against the drawing before trusting the 3D result.
// ---------------------------------------------------------------------------
function detectionInstructions() {
  return `
Look carefully at this architectural drawing or photo and identify what is actually shown — this is a reading task, not a design task, so describe only what you can actually see or reasonably infer from it, and say when something is unclear rather than guessing confidently. Respond with ONLY valid JSON (no markdown fences, no commentary) in exactly this shape:
{
  "floors": number of distinct stories/levels this drawing shows or clearly implies (1 if it's a single floor plan or a single-story photo),
  "scaleNote": "quote any scale indicator or dimension labels you can actually read off the drawing (e.g. 'scale marked 1:100', 'Living Room labeled 4.2m x 5.0m'), or state plainly 'no scale or dimensions marked — proportions will be estimated from typical room sizes' if none are visible",
  "rooms": [ { "name": "the room's label exactly as written on the drawing, or a reasonable name if unlabeled (e.g. 'Bedroom 2')", "floor": 1, "notes": "what you can tell about its approximate size or position from the drawing" } ],
  "walls": { "exterior": approximate count of distinct exterior wall segments you can see, "interior": approximate count of distinct interior partition walls, "notes": "wall thickness if marked, construction type if indicated" },
  "doors": [ { "location": "a specific description of where this door is, e.g. 'main entrance on the south/front wall' or 'connecting the Kitchen and Dining Room'", "floor": 1 } ],
  "windows": [ { "location": "a specific description of where this window is, e.g. 'two windows on the east wall of the Living Room'", "floor": 1 } ],
  "stairs": true or false — whether a staircase is visible or implied,
  "uncertain": [ "brief notes on any part of the drawing that is unclear, illegible, cut off, or ambiguous" ]
}
List EVERY room, door, and window you can actually identify in the drawing — do not skip any to save space, and do not invent ones you can't see just to look thorough. If the image is a photo of a finished building rather than a plan, infer floors/openings/likely room layout from what's visible on the exterior and say so in "uncertain".
`.trim();
}

async function detectBlueprintElements({ base64, mimeType, notes }) {
  const parts = [
    { text: `You are a professional architect's assistant reading an uploaded architectural drawing. ${notes ? `The architect adds this context: ${notes}.` : ''}\n${detectionInstructions()}` },
    { inlineData: { mimeType, data: base64 } },
  ];
  const text = await callGemini(parts);
  const detected = JSON.parse(stripFences(text));
  detected.source = 'read';
  return detected;
}

// Builds a plausible "what we detected" record when there's no live AI to
// actually read the image with — derived from whichever offline template
// got selected, and clearly labeled as not a real reading of the uploaded
// file, so the panel never implies the offline engine looked at the image.
function detectedFromOffline(tpl) {
  const modelParts = tpl.modelSpec.parts;
  const floors = [...new Set(modelParts.filter(p => p.group === 'structure').map(p => p.floor ?? 1))];
  const namedRooms = modelParts.filter(p => p.group === 'interior' && p.room && p.room !== 'auto');
  const doorCount = modelParts.filter(p => p.group === 'door').length;
  const interiorDoorCount = modelParts.filter(p => p.group === 'interior-door').length;
  const windowCount = modelParts.filter(p => p.group === 'window').length;
  return {
    source: 'offline',
    floors: floors.length || 1,
    scaleNote: 'No live AI connection was available, so this drawing was not actually read — a standard offline template was used instead.',
    rooms: namedRooms.length
      ? namedRooms.map(p => ({ name: p.room, floor: p.floor ?? 1, notes: 'from the offline template, not read from your drawing' }))
      : [{ name: 'Open interior', floor: 1, notes: 'estimated' }],
    walls: { exterior: 4, interior: modelParts.filter(p => p.group === 'interior' && p.size && Math.min(p.size[0], p.size[2]) < 0.3).length, notes: 'estimated' },
    doors: Array.from({ length: doorCount + interiorDoorCount }, (_, i) => ({ location: `Doorway ${i + 1} (estimated)`, floor: 1 })),
    windows: Array.from({ length: windowCount }, (_, i) => ({ location: `Window ${i + 1} (estimated)`, floor: 1 })),
    stairs: floors.length > 1,
    uncertain: ['This project ran on the offline engine — connect a Gemini API key for the AI to actually read your uploaded drawing.'],
  };
}

// ---------------------------------------------------------------------------
// OFFLINE_ENGINE: keyword-driven templates so the app works with no API key
// ---------------------------------------------------------------------------
const TEMPLATES = {
  table: {
    title: 'Modular Work Table', category: 'table',
    summary: 'A four-legged work table with a flat rectangular top, sized for a workshop or dining setting.',
    dimensions: [ { label: 'Height', value: '0.75 m' }, { label: 'Width', value: '1.40 m' }, { label: 'Depth', value: '0.70 m' } ],
    materials: [
      { name: 'Solid pine or birch plywood, 25mm', purpose: 'tabletop' },
      { name: '4x4 in timber posts', purpose: 'legs' },
      { name: '1x4 in pine boards', purpose: 'stretchers and aprons' },
      { name: 'Wood glue + 3in screws', purpose: 'joinery' },
    ],
    equipment: [
      { name: 'Circular saw or table saw', note: 'straight cuts' },
      { name: 'Drill/driver', note: 'pilot holes and screws' },
      { name: 'Orbital sander', note: 'surface finishing' },
      { name: 'Bar clamps', note: 'glue-up' },
    ],
    steps: [
      'Cut the tabletop panel and four legs to final dimensions.',
      'Cut apron boards and attach to legs with pocket screws.',
      'Add a lower stretcher between legs for rigidity.',
      'Attach the tabletop to the base.',
      'Sand progressively from 120 to 220 grit.',
      'Apply finish.',
    ],
    modelSpec: { parts: [
      { type: 'box', size: [1.4, 0.05, 0.7], position: [0, 0.75, 0], material: 'wood' },
      { type: 'box', size: [0.08, 0.7, 0.08], position: [-0.65, 0.35, -0.3], material: 'wood' },
      { type: 'box', size: [0.08, 0.7, 0.08], position: [0.65, 0.35, -0.3], material: 'wood' },
      { type: 'box', size: [0.08, 0.7, 0.08], position: [-0.65, 0.35, 0.3], material: 'wood' },
      { type: 'box', size: [0.08, 0.7, 0.08], position: [0.65, 0.35, 0.3], material: 'wood' },
    ] },
  },
  shelving: {
    title: 'Wall Shelving Unit', category: 'shelving',
    summary: 'An open shelving unit with evenly spaced shelves on two side panels.',
    dimensions: [ { label: 'Height', value: '1.80 m' }, { label: 'Width', value: '0.90 m' }, { label: 'Depth', value: '0.30 m' } ],
    materials: [
      { name: 'Plywood or MDF, 18mm', purpose: 'shelves and sides' },
      { name: 'Edge banding', purpose: 'clean edges' },
      { name: 'Shelf pins', purpose: 'adjustable support' },
    ],
    equipment: [
      { name: 'Track saw', note: 'sheet breakdown' },
      { name: 'Drill/driver', note: 'shelf-pin holes' },
      { name: 'Level', note: 'straight mounting' },
    ],
    steps: [
      'Cut side panels and shelf boards.',
      'Drill shelf-pin holes.',
      'Assemble sides and top/bottom shelves.',
      'Insert adjustable shelves.',
      'Anchor to wall studs.',
    ],
    modelSpec: { parts: [
      { type: 'box', size: [0.03, 1.8, 0.3], position: [-0.43, 0.9, 0], material: 'wood' },
      { type: 'box', size: [0.03, 1.8, 0.3], position: [0.43, 0.9, 0], material: 'wood' },
      { type: 'box', size: [0.9, 0.02, 0.3], position: [0, 0.1, 0], material: 'wood' },
      { type: 'box', size: [0.9, 0.02, 0.3], position: [0, 0.9, 0], material: 'wood' },
      { type: 'box', size: [0.9, 0.02, 0.3], position: [0, 1.7, 0], material: 'wood' },
    ] },
  },
  seating: {
    title: 'Slat-Back Bench', category: 'seating',
    summary: 'A sturdy bench with a slatted seat and angled back support.',
    dimensions: [ { label: 'Height', value: '0.85 m' }, { label: 'Width', value: '1.20 m' }, { label: 'Depth', value: '0.45 m' } ],
    materials: [
      { name: 'Cedar or oak boards, 20mm', purpose: 'seat and back slats' },
      { name: '4x4 in timber posts', purpose: 'legs' },
      { name: 'Exterior-grade screws', purpose: 'joinery' },
    ],
    equipment: [
      { name: 'Miter saw', note: 'angled cuts' },
      { name: 'Drill/driver', note: 'assembly' },
      { name: 'Sander', note: 'smooth surfaces' },
    ],
    steps: [
      'Cut legs, seat slats, and back supports.',
      'Assemble leg frames and lower stretcher.',
      'Fasten seat slats.',
      'Attach back uprights and slats.',
      'Sand and finish.',
    ],
    modelSpec: { parts: [
      { type: 'box', size: [1.2, 0.04, 0.08], position: [0, 0.45, -0.18], material: 'wood' },
      { type: 'box', size: [1.2, 0.04, 0.08], position: [0, 0.45, 0.18], material: 'wood' },
      { type: 'box', size: [0.08, 0.45, 0.08], position: [-0.55, 0.22, -0.15], material: 'wood' },
      { type: 'box', size: [0.08, 0.45, 0.08], position: [0.55, 0.22, -0.15], material: 'wood' },
      { type: 'box', size: [0.08, 0.4, 0.06], position: [-0.55, 0.68, -0.2], material: 'wood' },
      { type: 'box', size: [0.08, 0.4, 0.06], position: [0.55, 0.68, -0.2], material: 'wood' },
      { type: 'box', size: [1.2, 0.04, 0.06], position: [0, 0.82, -0.22], material: 'wood' },
    ] },
  },
  cabinet: {
    title: 'Enclosed Storage Cabinet', category: 'cabinet',
    summary: 'A boxed storage cabinet with a hinged door and one interior shelf.',
    dimensions: [ { label: 'Height', value: '0.90 m' }, { label: 'Width', value: '0.60 m' }, { label: 'Depth', value: '0.40 m' } ],
    materials: [
      { name: 'Plywood, 18mm', purpose: 'carcass' },
      { name: 'Concealed hinges', purpose: 'door movement' },
    ],
    equipment: [
      { name: 'Track saw', note: 'sheet breakdown' },
      { name: 'Hinge-boring bit', note: 'hinge cups' },
    ],
    steps: [
      'Cut carcass panels.',
      'Assemble carcass square.',
      'Fit interior shelf.',
      'Hang and align door.',
    ],
    modelSpec: { parts: [
      { type: 'box', size: [0.6, 0.02, 0.4], position: [0, 0.89, 0], material: 'wood' },
      { type: 'box', size: [0.6, 0.02, 0.4], position: [0, 0.01, 0], material: 'wood' },
      { type: 'box', size: [0.02, 0.9, 0.4], position: [-0.29, 0.45, 0], material: 'wood' },
      { type: 'box', size: [0.02, 0.9, 0.4], position: [0.29, 0.45, 0], material: 'wood' },
      { type: 'box', size: [0.58, 0.85, 0.02], position: [0, 0.46, 0.2], material: 'metal' },
    ] },
  },
  'outdoor-structure': {
    title: 'Garden Storage Shed', category: 'outdoor-structure',
    summary: 'A small hip-roofed outdoor structure for tool storage.',
    dimensions: [ { label: 'Height', value: '2.20 m' }, { label: 'Width', value: '2.40 m' }, { label: 'Depth', value: '1.80 m' } ],
    materials: [
      { name: '2x4 in pressure-treated lumber', purpose: 'framing' },
      { name: 'Exterior plywood, 12mm', purpose: 'sheathing' },
      { name: 'Asphalt roofing shingles', purpose: 'weatherproofing' },
    ],
    equipment: [
      { name: 'Circular saw', note: 'framing cuts' },
      { name: 'Framing nailer', note: 'assembly' },
      { name: 'Level', note: 'square foundation' },
    ],
    steps: [
      'Set the foundation.',
      'Build and raise wall frames.',
      'Sheath walls.',
      'Frame and raise the roof.',
      'Install shingles and door.',
    ],
    modelSpec: { parts: [
      { type: 'box', size: [2.4, 1.6, 1.8], position: [0, 0.8, 0], material: 'wood', group: 'structure' },
      { type: 'cylinder', radiusTop: 0.001, radiusBottom: 1.3, height: 0.9, position: [0, 2.05, 0], material: 'metal', group: 'roof' },
      { type: 'box', size: [0.55, 0.55, 0.03], position: [-0.7, 0.95, 0.92], material: 'glass', group: 'window' },
      { type: 'box', size: [0.55, 0.55, 0.03], position: [0.7, 0.95, 0.92], material: 'glass', group: 'window' },
      { type: 'box', size: [0.6, 1.3, 0.03], position: [-0.05, 0.65, 0.92], material: 'wood', group: 'door' },
      { type: 'box', size: [2.3, 0.03, 1.7], position: [0, 0.03, 0], material: 'wood', group: 'interior' },
    ] },
  },
  frame: {
    title: 'Structural Frame', category: 'frame',
    summary: 'A rectangular support frame for general fabrication.',
    dimensions: [ { label: 'Height', value: '1.00 m' }, { label: 'Width', value: '1.00 m' }, { label: 'Depth', value: '0.50 m' } ],
    materials: [ { name: 'Steel box tubing, 25x25mm', purpose: 'frame members' } ],
    equipment: [ { name: 'Angle grinder', note: 'cutting' }, { name: 'MIG welder', note: 'joining' } ],
    steps: [ 'Cut tubing to length.', 'Dry-fit and clamp square.', 'Weld and grind smooth.', 'Prime and paint.' ],
    modelSpec: { parts: [
      { type: 'box', size: [1.0, 0.03, 0.03], position: [0, 1.0, -0.25], material: 'metal' },
      { type: 'box', size: [1.0, 0.03, 0.03], position: [0, 1.0, 0.25], material: 'metal' },
      { type: 'box', size: [0.03, 1.0, 0.03], position: [-0.5, 0.5, -0.25], material: 'metal' },
      { type: 'box', size: [0.03, 1.0, 0.03], position: [0.5, 0.5, -0.25], material: 'metal' },
      { type: 'box', size: [0.03, 1.0, 0.03], position: [-0.5, 0.5, 0.25], material: 'metal' },
      { type: 'box', size: [0.03, 1.0, 0.03], position: [0.5, 0.5, 0.25], material: 'metal' },
    ] },
  },
  house: {
    title: 'Three-Bedroom House', category: 'house',
    summary: 'A single-story, three-bedroom home with a hip roof, exterior windows, a front door, and a fully room-partitioned interior layout, viewable once the roof is toggled off.',
    dimensions: [ { label: 'Height (to roof peak)', value: '5.00 m' }, { label: 'Width', value: '10.00 m' }, { label: 'Depth', value: '8.00 m' } ],
    materials: [
      { name: 'Concrete slab foundation', purpose: 'base structure' },
      { name: '2x6 in timber wall framing', purpose: 'load-bearing walls' },
      { name: 'Fiber-cement exterior siding', purpose: 'weatherproof cladding' },
      { name: 'Asphalt shingle roofing', purpose: 'roof weatherproofing' },
      { name: 'Double-glazed vinyl windows', purpose: 'natural light, insulation' },
      { name: 'Drywall interior partitions', purpose: 'room division' },
    ],
    equipment: [
      { name: 'Concrete mixer', note: 'foundation pour' },
      { name: 'Framing nailer', note: 'wall and roof framing' },
      { name: 'Circular saw', note: 'lumber cuts' },
      { name: 'Level & laser level', note: 'square, plumb walls' },
      { name: 'Ladder / scaffolding', note: 'roof work' },
    ],
    steps: [
      'Pour and cure the concrete slab foundation.',
      'Frame and raise exterior walls, then interior partitions.',
      'Frame and sheath the hip roof.',
      'Install windows, door, and exterior siding.',
      'Apply roofing shingles.',
      'Complete interior drywall and finish work.',
    ],
    modelSpec: { parts: (() => {
      const spec = { parts: [
        { type: 'box', size: [10, 3.2, 8], position: [0, 1.6, 0], material: 'wood', color: '#a9d3ea', group: 'structure' },
        { type: 'cylinder', radiusTop: 0.001, radiusBottom: 7.2, height: 1.8, position: [0, 4.1, 0], material: 'metal', color: '#243447', group: 'roof' },
        { type: 'box', size: [1.2, 1.2, 0.05], position: [-2.5, 1.8, 4.02], material: 'glass', group: 'window' },
        { type: 'box', size: [1.2, 1.2, 0.05], position: [2.5, 1.8, 4.02], material: 'glass', group: 'window' },
        { type: 'box', size: [0.05, 1.2, 1.2], position: [-5.02, 1.8, -1], material: 'glass', group: 'window' },
        { type: 'box', size: [0.05, 1.2, 1.2], position: [5.02, 1.8, 1.5], material: 'glass', group: 'window' },
        { type: 'box', size: [0.9, 2.05, 0.05], position: [0, 1.025, 4.02], material: 'wood', color: '#3f6fa0', group: 'door' },
        { type: 'box', size: [9.6, 0.05, 7.6], position: [0, 0.03, 0], material: 'wood', color: '#c9b28a', group: 'interior' },
      ] };
      // Real front-zone/hallway/bedroom-bay layout instead of one or two
      // straight walls slicing the box into equal cells.
      buildRealisticFloorPlan(spec, 1, spec.parts[0]);
      return spec.parts;
    })() },
  },
  duplex: {
    title: 'Two-Story Duplex', category: 'house',
    summary: 'A two-story, four-bedroom duplex — a distinct ground-floor footprint with living areas and a kitchen, a bedroom floor above with a front balcony, and its own roofline, string-course trim between floors, and a fully room-partitioned interior on both levels.',
    dimensions: [ { label: 'Height (to roof peak)', value: '8.10 m' }, { label: 'Width', value: '10.00 m' }, { label: 'Depth', value: '8.00 m' } ],
    materials: [
      { name: 'Reinforced concrete slab & footing', purpose: 'foundation for a two-story load' },
      { name: '2x6 in timber wall framing', purpose: 'load-bearing walls, both floors' },
      { name: 'Fiber-cement exterior siding', purpose: 'weatherproof cladding' },
      { name: 'Asphalt shingle roofing', purpose: 'roof weatherproofing' },
      { name: 'Double-glazed vinyl windows', purpose: 'natural light, insulation' },
      { name: 'Powder-coated steel balcony railing', purpose: 'upper-floor balcony' },
      { name: 'Drywall interior partitions', purpose: 'room division, both floors' },
    ],
    equipment: [
      { name: 'Concrete mixer & pump', note: 'foundation pour' },
      { name: 'Framing nailer', note: 'wall and roof framing' },
      { name: 'Circular saw', note: 'lumber cuts' },
      { name: 'Scaffolding tower', note: 'second-floor and roof work' },
      { name: 'Level & laser level', note: 'square, plumb walls across both floors' },
    ],
    steps: [
      'Pour and cure the reinforced concrete slab and footing.',
      'Frame and raise ground-floor exterior walls, then interior partitions.',
      'Install the first-floor deck and frame the upper-floor walls on top.',
      'Frame and sheath the roof; build out the front balcony structure and railing.',
      'Install windows, doors (including the upper-floor balcony door), and exterior siding.',
      'Apply roofing shingles and finish exterior trim.',
      'Complete interior drywall and finish work on both floors.',
    ],
    modelSpec: { parts: (() => {
      const spec = { parts: [
        // Ground floor (y 0 → 3)
        { type: 'box', size: [10, 3, 8], position: [0, 1.5, 0], material: 'wood', color: '#bcdcee', group: 'structure', floor: 1 },
        { type: 'box', size: [1.2, 1.3, 0.05], position: [-3.3, 1.55, 4.02], material: 'glass', group: 'window', floor: 1 },
        { type: 'box', size: [1.2, 1.3, 0.05], position: [1.7, 1.55, 4.02], material: 'glass', group: 'window', floor: 1 },
        { type: 'box', size: [0.05, 1.3, 1.3], position: [-5.02, 1.55, -1.2], material: 'glass', group: 'window', floor: 1 },
        { type: 'box', size: [0.05, 1.3, 1.3], position: [5.02, 1.55, 1.6], material: 'glass', group: 'window', floor: 1 },
        { type: 'box', size: [1.3, 1.3, 0.05], position: [0, 1.55, -4.02], material: 'glass', group: 'window', floor: 1 },
        { type: 'box', size: [0.95, 2.05, 0.05], position: [-0.9, 1.025, 4.02], material: 'wood', color: '#6b4a2f', group: 'door', floor: 1 },
        { type: 'box', size: [9.6, 0.05, 7.6], position: [0, 0.03, 0], material: 'wood', color: '#c9b28a', group: 'interior', floor: 1 },
        // Upper floor (y 3 → 6) — same footprint, own openings, own trim tone
        { type: 'box', size: [10, 3, 8], position: [0, 4.5, 0], material: 'wood', color: '#8fc4e0', group: 'structure', floor: 2 },
        { type: 'box', size: [1.1, 1.2, 0.05], position: [-3.6, 4.5, 4.02], material: 'glass', group: 'window', floor: 2 },
        { type: 'box', size: [1.1, 1.2, 0.05], position: [3.0, 4.5, 4.02], material: 'glass', group: 'window', floor: 2 },
        { type: 'box', size: [0.05, 1.2, 1.2], position: [-5.02, 4.5, -1.6], material: 'glass', group: 'window', floor: 2 },
        { type: 'box', size: [0.05, 1.2, 1.2], position: [5.02, 4.5, 1.8], material: 'glass', group: 'window', floor: 2 },
        { type: 'box', size: [1.2, 1.2, 0.05], position: [0.2, 4.5, -4.02], material: 'glass', group: 'window', floor: 2 },
        { type: 'box', size: [1.6, 2.05, 0.05], position: [-0.4, 4.025, 4.02], material: 'glass', color: '#bcdfe6', group: 'door', floor: 2 },
        { type: 'box', size: [3.2, 1.0, 1.3], position: [-0.4, 3.0, 4.02], material: 'wood', color: '#c9b28a', group: 'balcony', floor: 2 },
        { type: 'box', size: [9.6, 0.05, 7.6], position: [0, 3.03, 0], material: 'wood', color: '#e3d8c1', group: 'interior', floor: 2 },
        // Roof atop the upper floor
        { type: 'cylinder', radiusTop: 0.001, radiusBottom: 7.3, height: 2.1, position: [0, 7.05, 0], material: 'metal', color: '#243447', group: 'roof', floor: 2 },
      ] };
      // Real front-zone/hallway/bedroom-bay layout on each floor instead of
      // one straight wall slicing each floor into two equal rooms.
      const floor1Envelope = spec.parts.find(p => p.group === 'structure' && p.floor === 1);
      const floor2Envelope = spec.parts.find(p => p.group === 'structure' && p.floor === 2);
      buildRealisticFloorPlan(spec, 1, floor1Envelope);
      buildRealisticFloorPlan(spec, 2, floor2Envelope);
      return spec.parts;
    })() },
  },
};

const KEYWORD_MAP = [
  { cat: 'table', words: ['table', 'desk', 'workbench', 'counter'] },
  { cat: 'shelving', words: ['shelf', 'shelving', 'bookcase', 'rack'] },
  { cat: 'seating', words: ['bench', 'chair', 'seat', 'stool'] },
  { cat: 'cabinet', words: ['cabinet', 'cupboard', 'closet', 'wardrobe', 'drawer'] },
  { cat: 'duplex', words: ['duplex', 'two-story', 'two story', '2-story', '2 story', 'two-storey', 'two storey', '2-storey', '2 storey', 'multi-story', 'multi-storey', 'multistory', 'multistorey', 'storey building', 'story building', 'upstairs', 'penthouse', 'second floor', 'first floor and second', 'triplex'] },
  { cat: 'house', words: ['house', 'home', 'bungalow', 'cottage', 'bedroom', 'apartment', 'floor plan', 'blueprint'] },
  { cat: 'outdoor-structure', words: ['shed', 'deck', 'pergola', 'fence', 'gazebo', 'coop', 'barn'] },
  { cat: 'frame', words: ['frame', 'stand', 'mount', 'bracket'] },
];

function detectCategory(text) {
  const t = (text || '').toLowerCase();
  for (const entry of KEYWORD_MAP) {
    if (entry.words.some(w => t.includes(w))) return entry.cat;
  }
  return null;
}

function offlineDesign(hintText, fileName) {
  const cat = detectCategory(hintText) || detectCategory(fileName) || 'house';
  const tpl = TEMPLATES[cat] || TEMPLATES.house;
  return JSON.parse(JSON.stringify(tpl));
}

function offlineChatReply(message) {
  const result = offlineDesign(message, '');
  const reply = `Here's a concept for "${result.title}" based on what you described — dimensions, materials, equipment, and an editable 3D preview on the right. Tell me what to change (room count, size, style, colors) and I'll refine it.`;
  return { reply, result };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Blueprint -> DesignBrief (Phase 3): turns the vision reading from
// detectBlueprintElements() above into a DesignBrief, so an uploaded floor
// plan goes through the SAME architecture engine as chat/estate instead of
// its own box-coordinate reconstruction. This is deliberately NOT a second
// Gemini call — detectBlueprintElements already did the one thing only
// vision can do (read the drawing); everything here is a deterministic,
// inspectable classification of that reading, which is more faithful than
// asking a second model call to re-guess room composition from its own
// JSON summary of the first.
// Known limitation (documented, not hidden): this reproduces the drawing's
// FLOOR COUNT and ROOM COMPOSITION faithfully, but wall positions/room
// shapes still come from the same procedural space-planner chat uses —
// true pixel-traced wall geometry (matching the exact drawn layout line for
// line) is not implemented in this pass. See delivery notes.
// ---------------------------------------------------------------------------
function classifyRoom(name) {
  const n = (name || '').toLowerCase();
  // Bathroom/ensuite check comes first: "Master Ensuite" or "Master Bath"
  // would otherwise match the bedroom regex's "master" branch before ever
  // reaching this check.
  if (/bath|toilet|w\.?c\.?|ensuite/.test(n)) return 'bathroom';
  if (/\bbed(room)?\b|master/.test(n)) return 'bedroom';
  if (/kitchen/.test(n)) return 'kitchen';
  if (/dining/.test(n)) return 'dining';
  if (/living|parlor|parlour|sitting/.test(n)) return 'living';
  if (/lounge|family room/.test(n)) return 'lounge';
  if (/foyer|entrance|lobby/.test(n)) return 'foyer';
  if (/garage|carport/.test(n)) return 'garage';
  if (/\bbq\b|boys.?quarters|staff quarters|servant/.test(n)) return 'bq';
  if (/balcony|terrace/.test(n)) return 'balcony';
  if (/porch|veranda|verandah/.test(n)) return 'porch';
  if (/store|storage|pantry/.test(n)) return 'store';
  return 'other';
}

// Only trusts a dimension pair in scaleNote when it's explicitly tied to
// the word "building"/"overall"/"total" in the same clause — otherwise a
// labeled room dimension (e.g. "Living Room labeled 4.2m x 5.0m") would get
// mistaken for the whole building's footprint. Falls back to a room-count
// based estimate, same formula the chat offline path uses.
function footprintFromDetected(detected, bedroomCount, floors) {
  const note = (detected?.scaleNote || '').toLowerCase();
  const m = note.match(/(?:building|overall|total)[^.]*?(\d+(?:\.\d+)?)\s*m?\s*(?:x|by)\s*(\d+(?:\.\d+)?)\s*m/);
  if (m) {
    return { width: clampNumber(m[1], 7, 20, 10), depth: clampNumber(m[2], 6, 18, 9) };
  }
  return { width: 9 + bedroomCount * 0.7 + floors * 0.4, depth: 8 + Math.min(floors, 2) * 0.5 };
}

function designBriefFromBlueprint(detected, notes) {
  const floors = Math.round(clampNumber(detected?.floors, 1, 4, 1));
  const rooms = Array.isArray(detected?.rooms) ? detected.rooms : [];
  const typeCounts = {};
  rooms.forEach((r) => {
    const type = classifyRoom(r.name);
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  });
  const bedrooms = clampNumber(typeCounts.bedroom || 0, 1, 10, 3);
  const bathrooms = clampNumber(typeCounts.bathroom || 0, 1, 8, Math.max(1, Math.ceil(bedrooms / 2)));

  // Style/roof aren't things a vision read of room labels can determine —
  // pull from the architect's notes with the same heuristic chat uses, so
  // "traditional 4-bedroom bungalow, hip roof" typed alongside the upload
  // still lands correctly, and default to a plain, neutral guess otherwise.
  const notesBrief = offlineDesignBrief(notes || '');
  const style = /modern|contemporary|minimalist|luxury|traditional|nigerian|mediterranean|colonial|tropical|industrial|scandinavian/i.test(notes || '')
    ? notesBrief.style : 'traditional';
  const roofType = /flat roof|mono[-\s]?pitch|gable|hip roof/i.test(notes || '') ? notesBrief.roofType : (style === 'modern' ? 'flat' : 'hip');

  return clampDesignBrief({
    floors,
    footprint: footprintFromDetected(detected, bedrooms, floors),
    bedrooms,
    bathrooms,
    roofType,
    style,
    features: {
      garage: !!typeCounts.garage,
      bq: !!typeCounts.bq,
      balcony: !!typeCounts.balcony || !!detected?.stairs,
      porch: !!typeCounts.porch,
      compoundWall: /compound wall|perimeter fence|estate/i.test(notes || ''),
      gate: /security gate|\bgate\b/i.test(notes || ''),
    },
  }, null);
}

function descriptiveTextFromBlueprint(brief, detected) {
  const base = offlineDescriptiveText(brief);
  const uncertainNote = Array.isArray(detected?.uncertain) && detected.uncertain.length
    ? ` Some parts of the drawing were unclear: ${detected.uncertain.slice(0, 2).join('; ')}.`
    : '';
  return {
    ...base,
    summary: `Read from your uploaded drawing: ${base.summary}${uncertainNote}`,
  };
}

async function analyzeBlueprint({ base64, mimeType, fileName, notes }) {
  if (genAI) {
    try {
      const detected = await detectBlueprintElements({ base64, mimeType, notes });
      const brief = designBriefFromBlueprint(detected, notes);
      const text = descriptiveTextFromBlueprint(brief, detected);
      return {
        ...text,
        category: brief.floors > 1 ? 'duplex' : 'house',
        modelSpec: { designBrief: brief },
        detected,
        engine: 'gemini',
      };
    } catch (err) {
      console.error('Gemini blueprint analysis failed, falling back to offline engine:', err.message);
    }
  }
  const brief = offlineDesignBrief(notes || fileName || '');
  const text = offlineDescriptiveText(brief);
  return {
    ...text,
    category: brief.floors > 1 ? 'duplex' : 'house',
    modelSpec: { designBrief: brief },
    detected: detectedFromOfflineBrief(brief),
    engine: 'offline',
  };
}

// Offline-engine "what we detected" panel content for the new brief-based
// path — mirrors detectedFromOffline() above (which describes the legacy
// template's parts) but describes a DesignBrief instead, and is equally
// explicit that no real image reading happened.
function detectedFromOfflineBrief(brief) {
  return {
    source: 'offline',
    floors: brief.floors,
    scaleNote: 'No live AI connection was available, so this drawing was not actually read — room counts were estimated instead.',
    rooms: [{ name: `${brief.bedrooms} bedroom(s), ${brief.bathrooms} bathroom(s)`, floor: 1, notes: 'estimated, not read from your drawing' }],
    walls: { exterior: 4, interior: brief.bedrooms + brief.bathrooms, notes: 'estimated' },
    doors: [], windows: [],
    stairs: brief.floors > 1,
    uncertain: ['This project ran on the offline engine — connect a Gemini API key for the AI to actually read your uploaded drawing.'],
  };
}


// ---------------------------------------------------------------------------
// Architectural DesignBrief contract — Phase 2 of the architecture-engine
// rebuild, used for residential building requests (category 'house' or
// 'duplex'). This replaces the box-coordinate schemaInstructions() contract
// above for those requests: Gemini describes WHAT the building is (floors,
// bedrooms, roof type, style, features), and the deterministic
// space-planning engine (frontend/src/three/architecture/
// designBriefToBuilding.js -> generateBuildingFromBrief) decides HOW to
// turn that into wall coordinates, room polygons, openings, stairs and
// roof geometry — Gemini never invents raw 3D coordinates. Furniture and
// non-residential categories (table, shelving, seating, cabinet,
// outdoor-structure, frame, generic) are unaffected and still use
// schemaInstructions()/parts below.
// ---------------------------------------------------------------------------
const ROOF_TYPES = ['hip', 'gable', 'flat', 'mono'];
const STYLES = ['modern', 'contemporary', 'minimalist', 'luxury', 'traditional', 'nigerian modern residential', 'mediterranean', 'colonial', 'tropical', 'industrial', 'scandinavian'];

function designBriefSchemaInstructions() {
  return `
Respond with ONLY valid JSON (no markdown fences, no commentary) matching exactly this shape:
{
  "title": "short project name",
  "summary": "2-3 sentence plain-language description of the design",
  "dimensions": [ {"label":"Bedrooms","value":"4"}, {"label":"Floors","value":"2"}, {"label":"Footprint","value":"12m x 10m"} ],
  "materials": [ {"name":"Painted plaster render","purpose":"exterior finish"}, ... 4-8 items ],
  "equipment": [ {"name":"Concrete mixer","note":"foundation and slab work"}, ... 4-8 items ],
  "steps": [ "short build step 1", "short build step 2", ... 4-6 items ],
  "designBrief": {
    "name": "short building name",
    "floors": 1,
    "floorHeight": 3.0,
    "footprint": { "width": 12, "depth": 10 },
    "setbackPerFloor": [ {"width": 10.5, "depth": 9} ],
    "bedrooms": 3,
    "bathrooms": 2,
    "roofType": "hip",
    "style": "modern",
    "features": { "garage": false, "balcony": false, "porch": false, "compoundWall": false, "gate": false, "bq": false }
  }
}
Rules for "designBrief" — this describes WHAT the building is; the application's own geometry engine derives all wall coordinates, room shapes, window/door placement, stair geometry and roof planes from it automatically, so do NOT invent any of that yourself and do NOT include a "modelSpec.parts" field:
- "floors": 1 for a bungalow/cottage/single-storey home. 2 for a duplex/two-storey home. 3 or 4 only if the brief explicitly says three-storey/four-storey/three floors/four floors etc. Never invent extra floors the person didn't ask for.
- "footprint": choose realistic metres for the bedroom count and floor count — roughly 9x8 for 2-3 bedrooms, 11x9 for 3-4 bedrooms, 13x10+ for 5+ bedrooms or 2+ floors. Keep width/depth between 7 and 20 metres.
- "setbackPerFloor": an array with one entry per floor ABOVE the first (so a 2-floor building has at most 1 entry, a 3-floor building at most 2). Only include entries if the brief asks for upper-floor setback, a smaller top floor, or stepped/contemporary massing — leave it an empty array for an ordinary duplex where every floor shares the same footprint. Each entry's width/depth must be smaller than the floor below it.
- "bedrooms"/"bathrooms": read directly from the brief; default bathrooms to roughly half the bedroom count (minimum 1) if not mentioned.
- "roofType": one of ${ROOF_TYPES.join(' | ')}. Prefer "flat" or "mono" for modern/contemporary/minimalist/industrial styles unless the brief asks for something else; prefer "hip" or "gable" for traditional/colonial/Nigerian modern residential/Mediterranean/tropical styles.
- "style": one of ${STYLES.join(' | ')} — pick whichever the brief most resembles, defaulting to "modern" if nothing suggests otherwise.
- "features": set "garage" true only if a garage or carport is mentioned; "bq" true only if BQ/boys' quarters/staff quarters is mentioned; "balcony"/"porch" true only if actually mentioned or clearly implied by the style; "compoundWall"/"gate" true only if a perimeter fence/security gate/estate context is mentioned.
The "title"/"summary"/"dimensions"/"materials"/"equipment"/"steps" fields are free-form descriptive text for the person reading the proposal — keep them accurate to the designBrief you produced (e.g. don't describe a garage in "summary" if "features.garage" is false).
`.trim();
}

function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Defensive clamp on whatever Gemini returns, independent of the fuller
// validateBuilding()/autoRepairBuilding() pass the frontend's architecture
// engine runs again at render time (section 23 of the rebuild spec calls
// for validation at both the AI-output boundary and the geometry boundary,
// not just one or the other).
function clampDesignBrief(raw, fallbackName) {
  const b = raw || {};
  const floors = Math.round(clampNumber(b.floors, 1, 4, 1));
  const footprint = {
    width: clampNumber(b.footprint?.width, 7, 20, 10),
    depth: clampNumber(b.footprint?.depth, 6, 18, 9),
  };
  const setbackPerFloor = Array.isArray(b.setbackPerFloor)
    ? b.setbackPerFloor.slice(0, Math.max(0, floors - 1)).map((s, i) => {
      const prevW = i === 0 ? footprint.width : clampNumber(b.setbackPerFloor[i - 1]?.width, 5, 20, footprint.width);
      const prevD = i === 0 ? footprint.depth : clampNumber(b.setbackPerFloor[i - 1]?.depth, 5, 18, footprint.depth);
      return {
        width: clampNumber(s?.width, 5, prevW, prevW),
        depth: clampNumber(s?.depth, 4, prevD, prevD),
      };
    })
    : [];
  const roofType = ROOF_TYPES.includes(b.roofType) ? b.roofType : 'hip';
  const style = STYLES.includes((b.style || '').toLowerCase()) ? b.style.toLowerCase() : 'modern';
  const bedrooms = Math.round(clampNumber(b.bedrooms, 1, 10, 3));
  const bathrooms = Math.round(clampNumber(b.bathrooms, 1, 8, Math.max(1, Math.ceil(bedrooms / 2))));
  const f = b.features || {};
  return {
    name: (typeof b.name === 'string' && b.name.trim()) || fallbackName || `${bedrooms}-Bedroom ${floors === 1 ? 'Bungalow' : floors === 2 ? 'Duplex' : `${floors}-Storey House`}`,
    floors,
    floorHeight: clampNumber(b.floorHeight, 2.6, 3.6, 3.0),
    footprint,
    setbackPerFloor,
    bedrooms,
    bathrooms,
    roofType,
    style,
    features: {
      garage: !!f.garage, balcony: !!f.balcony, porch: !!f.porch,
      compoundWall: !!f.compoundWall, gate: !!f.gate, bq: !!f.bq,
    },
  };
}

// Offline fallback: no Gemini key, or Gemini failed. Parses the same
// signals a person would read off the message by eye (bedroom count,
// duplex/storey wording, garage/pool/BQ mentions, style keywords) into a
// DesignBrief so the offline engine still produces a real multi-room,
// multi-storey-capable building rather than reverting to a flat template
// box (section 31 of the rebuild spec).
function offlineDesignBrief(message) {
  const t = (message || '').toLowerCase();
  const bedroomMatch = t.match(/(\d+)\s*[-\s]?(?:bed|bedroom)/);
  const bedrooms = bedroomMatch ? clampNumber(bedroomMatch[1], 1, 10, 3) : 3;
  const bathroomMatch = t.match(/(\d+)\s*[-\s]?(?:bath|bathroom)/);

  let floors = 1;
  if (/\b(three|3)[-\s]?(storey|story|floor)/.test(t)) floors = 3;
  else if (/\b(four|4)[-\s]?(storey|story|floor)/.test(t)) floors = 4;
  else if (/duplex|two[-\s]?stor(e|y)|2[-\s]?stor(e|y)|multi[-\s]?stor(e|y)|upstairs|penthouse|triplex/.test(t)) floors = 2;
  else if (/bungalow|single[-\s]?stor(e|y)|one[-\s]?stor(e|y)/.test(t)) floors = 1;

  const style = STYLES.find((s) => t.includes(s)) || (/modern|contemporary/.test(t) ? 'modern' : /traditional|colonial/.test(t) ? 'traditional' : 'modern');
  const roofType = /flat roof/.test(t) ? 'flat' : /mono[-\s]?pitch/.test(t) ? 'mono' : /gable/.test(t) ? 'gable' : /hip roof/.test(t) ? 'hip'
    : (style === 'modern' || style === 'contemporary' || style === 'minimalist' || style === 'industrial') ? 'flat' : 'hip';

  return clampDesignBrief({
    floors,
    footprint: { width: 9 + bedrooms * 0.7 + floors * 0.4, depth: 8 + Math.min(floors, 2) * 0.5 },
    bedrooms,
    bathrooms: bathroomMatch ? Number(bathroomMatch[1]) : undefined,
    roofType,
    style,
    features: {
      garage: /garage|carport/.test(t),
      balcony: /balcony/.test(t) || floors > 1,
      porch: /porch|veranda|verandah/.test(t),
      compoundWall: /compound wall|perimeter fence|estate/.test(t),
      gate: /security gate|\bgate\b/.test(t),
      bq: /\bbq\b|boys.?quarters|staff quarters|servant.?quarters/.test(t),
    },
  }, null);
}

function offlineDescriptiveText(brief) {
  const title = `${brief.bedrooms}-Bedroom ${brief.floors > 1 ? (brief.floors === 2 ? 'Duplex' : `${brief.floors}-Storey House`) : 'Bungalow'}`;
  const summary = `A ${brief.style} ${brief.floors > 1 ? `${brief.floors}-storey` : 'single-storey'} home with ${brief.bedrooms} bedroom${brief.bedrooms === 1 ? '' : 's'} and ${brief.bathrooms} bathroom${brief.bathrooms === 1 ? '' : 's'}, a ${brief.roofType} roof${brief.features.garage ? ', an attached garage' : ''}${brief.features.balcony ? ', a balcony' : ''}${brief.features.bq ? ', and a BQ' : ''}.`;
  return {
    title,
    summary,
    dimensions: [
      { label: 'Bedrooms', value: String(brief.bedrooms) },
      { label: 'Floors', value: String(brief.floors) },
      { label: 'Footprint', value: `${brief.footprint.width.toFixed(1)}m x ${brief.footprint.depth.toFixed(1)}m` },
    ],
    materials: [
      { name: 'Painted plaster render', purpose: 'exterior finish' },
      { name: 'Reinforced concrete', purpose: 'slab and structural frame' },
      { name: 'Aluminium window frames', purpose: 'glazing' },
      { name: brief.roofType === 'flat' ? 'Waterproofed concrete roof deck' : 'Aluminium roofing sheets', purpose: 'roof covering' },
    ],
    equipment: [
      { name: 'Concrete mixer', note: 'foundation and slab work' },
      { name: 'Scaffolding', note: 'wall and roof construction' },
      { name: 'Level and theodolite', note: 'site setting out' },
    ],
    steps: ['Site clearing and setting out', 'Foundation and ground slab', 'Wall construction', 'Roofing', 'Windows, doors and finishes'],
  };
}

async function chatDesignArchitectural({ message, convo }) {
  if (genAI) {
    try {
      const parts = [
        { text: `You are a professional architectural design assistant embedded in an app called Arch-3d build. A user is describing a residential building they want designed. Conversation so far:\n${convo}\nUser: ${message}\n\n${designBriefSchemaInstructions()}` },
      ];
      const text = await callGemini(parts);
      const json = JSON.parse(stripFences(text));
      const brief = clampDesignBrief(json.designBrief, json.title);
      return {
        reply: json.title ? `Here's a concept for "${json.title}".` : 'Here is a concept based on your description.',
        result: {
          title: json.title || brief.name,
          category: brief.floors > 1 ? 'duplex' : 'house',
          summary: json.summary || '',
          dimensions: Array.isArray(json.dimensions) ? json.dimensions : [],
          materials: Array.isArray(json.materials) ? json.materials : [],
          equipment: Array.isArray(json.equipment) ? json.equipment : [],
          steps: Array.isArray(json.steps) ? json.steps : [],
          modelSpec: { designBrief: brief },
          engine: 'gemini',
        },
      };
    } catch (err) {
      console.error('Gemini architectural chat design failed, falling back to offline engine:', err.message);
    }
  }
  const brief = offlineDesignBrief(message);
  const text = offlineDescriptiveText(brief);
  return {
    reply: `Here's a concept for "${text.title}" based on what you described — an editable 3D preview built by the architectural engine is on the right. Tell me what to change (room count, floors, style, features) and I'll refine it.`,
    result: { ...text, category: brief.floors > 1 ? 'duplex' : 'house', modelSpec: { designBrief: brief }, engine: 'offline' },
  };
}

async function chatDesign({ message, history }) {
  const convo = (history || []).map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n');
  const localCategory = detectCategory(message) || detectCategory(convo) || 'house';

  // Residential building requests go through the new architecture engine
  // (Phase 2): Gemini produces a DesignBrief, not raw box coordinates.
  // Furniture/outdoor-structure/frame/generic requests are unrelated to
  // the architecture rebuild and keep using the legacy parts pipeline.
  if (localCategory === 'house' || localCategory === 'duplex') {
    return chatDesignArchitectural({ message, convo });
  }

  if (genAI) {
    try {
      const parts = [
        { text: `You are a professional architectural design assistant embedded in an app called Arch-3d build. A user is describing a building or space they want designed. Conversation so far:\n${convo}\nUser: ${message}\n\n${schemaInstructions()}` },
      ];
      const text = await callGemini(parts);
      const json = reinforceDesign(JSON.parse(stripFences(text)));
      return {
        reply: json.title ? `Here's a concept for "${json.title}".` : 'Here is a concept based on your description.',
        result: { ...json, engine: 'gemini' },
      };
    } catch (err) {
      console.error('Gemini chat design failed, falling back to offline engine:', err.message);
    }
  }
  const offline = offlineChatReply(message);
  return { reply: offline.reply, result: { ...offline.result, engine: 'offline' } };
}

// ---------------------------------------------------------------------------
// Photorealistic concept render (separate from the interactive 3D preview)
// ---------------------------------------------------------------------------
// Note: gemini-2.5-flash-image is Google's free-tier image model as of
// mid-2026 but Google has scheduled it to retire Oct 2, 2026 — check
// https://ai.google.dev/gemini-api/docs/models for its replacement if this
// starts failing. Treated as optional/best-effort everywhere: if it fails
// for any reason, the rest of the app keeps working without it.
async function generateRenderImage({ title, summary, materials }) {
  if (!genAI) return null;
  try {
    const materialNames = (materials || []).slice(0, 4).map(m => m.name).join(', ');
    const prompt = `Professional architectural visualization photograph of: ${title}. ${summary} Primary materials: ${materialNames}. Style: photorealistic 3D architectural render, natural daylight, clean composition, high detail, no people, no text overlays, no watermark, no logo.`;
    const response = await genAI.models.generateContent({ model: IMAGE_MODEL, contents: prompt });
    const parts = response?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData);
    if (!imagePart) return null;
    return { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType || 'image/png' };
  } catch (err) {
    console.error('Render image generation failed (non-fatal):', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cost estimate — attempts real Google Search grounding for current pricing;
// falls back to reasoning-only AI estimate, then a rough offline formula.
// Always clearly labeled to the user as an approximation either way.
// ---------------------------------------------------------------------------
async function generateCostEstimate({ title, summary, materials, equipment, dimensions, budget, location }) {
  const materialList = (materials || []).map(m => m.name).join(', ');
  const equipmentList = (equipment || []).map(e => e.name).join(', ');
  const dimensionList = (dimensions || []).map(d => `${d.label}: ${d.value}`).join(', ');
  const basePrompt = `You are a construction cost estimator. Project: "${title}". ${summary} Dimensions: ${dimensionList}. Materials: ${materialList}. Equipment/labor involved: ${equipmentList}. ${budget ? `The person's stated budget is ${budget}.` : 'No budget was given.'} ${location ? `The project location is: ${location}. Use realistic costs and typical pricing for that specific location, and give the estimate in that location's local currency.` : 'No location was given — estimate for a typical US project and use USD.'}
Give a realistic, current, rough-order-of-magnitude cost estimate. Respond with ONLY valid JSON, no markdown fences, no commentary, in this exact shape:
{
  "currency": "3-letter ISO currency code appropriate for the location, e.g. USD, NGN, GBP, EUR, INR",
  "currencySymbol": "the common symbol or prefix for that currency, e.g. $, \u20a6, \u00a3, \u20ac, \u20b9",
  "materialsLow": number, "materialsHigh": number,
  "laborLow": number, "laborHigh": number,
  "timeline": "short human-readable estimate, e.g. '4-6 months'",
  "budgetNote": "1-2 sentences directly addressing whether the stated budget is realistic for this scope and location, or general advice if no budget was given",
  "notes": "1-2 sentences on what most affects the price range for this location (import costs, local labor rates, finish level, etc.)"
}
All numbers are plain numbers in the chosen local currency, no symbols or commas.`;

  if (genAI) {
    // Attempt 1: with Google Search grounding for more current, location-aware figures.
    try {
      const response = await genAI.models.generateContent({
        model: TEXT_MODEL,
        contents: [{ role: 'user', parts: [{ text: basePrompt }] }],
        config: { temperature: 0.3, tools: [{ googleSearch: {} }] },
      });
      const json = JSON.parse(stripFences(response.text || ''));
      return { ...json, grounded: true, engine: 'gemini' };
    } catch (err) {
      console.error('Grounded cost estimate failed, trying ungrounded:', err.message);
    }
    // Attempt 2: plain reasoning, no search grounding.
    try {
      const text = await callGemini([{ text: basePrompt }]);
      const json = JSON.parse(stripFences(text));
      return { ...json, grounded: false, engine: 'gemini' };
    } catch (err) {
      console.error('Ungrounded cost estimate failed, falling back to offline formula:', err.message);
    }
  }

  // Offline fallback: rough area-based US formula, clearly approximate.
  // No AI reasoning available offline, so this always estimates in USD
  // regardless of location — noted plainly to the person in budgetNote.
  const widthMatch = (dimensions || []).find(d => /width/i.test(d.label));
  const depthMatch = (dimensions || []).find(d => /depth/i.test(d.label));
  const width = widthMatch ? parseFloat(widthMatch.value) : 10;
  const depth = depthMatch ? parseFloat(depthMatch.value) : 8;
  const sqm = (isFinite(width) ? width : 10) * (isFinite(depth) ? depth : 8);
  const sqft = sqm * 10.76;
  return {
    currency: 'USD',
    currencySymbol: '$',
    materialsLow: Math.round(sqft * 90),
    materialsHigh: Math.round(sqft * 160),
    laborLow: Math.round(sqft * 60),
    laborHigh: Math.round(sqft * 110),
    timeline: sqft > 1500 ? '6-10 months' : '3-6 months',
    budgetNote: (location
      ? `This offline formula always estimates in USD and can't account for ${location} specifically — connect a Gemini API key for a location-aware, local-currency estimate. `
      : 'Add a budget and location above for a direct, location-aware comparison. ') +
      'This is a rough national average, not a live estimate — always get local contractor quotes.',
    notes: 'Offline formula based on typical US per-square-foot ranges; actual costs vary heavily by region, finish level, and site conditions.',
    grounded: false,
    engine: 'offline',
  };
}

// ---------------------------------------------------------------------------
// ESTATE / COMPOUND GENERATION
//
// An estate is generated as N independent buildings (each reusing the same
// proven single-building JSON contract above, so each house gets the same
// real walls/openings/rooms quality as a standalone design) plus a SEPARATE,
// purely procedural site-layout step that places them on the site.
//
// The layout is deliberately NOT left to the AI: grid math guarantees
// non-overlapping footprints and consistent road spacing every time, which
// is the "geometric correctness before visual decoration" principle this
// app is built around — an AI-guessed layout could plausibly overlap houses
// or ignore the site boundary, a procedural one cannot.
// ---------------------------------------------------------------------------

// Parses explicit building-mix instructions out of an estate brief, e.g.
// "8 houses: four 3-bedroom bungalows and four 4-bedroom duplexes" ->
// [ {bedrooms:3,floors:1} x4, {bedrooms:4,floors:2} x4 ]. Returns null if
// nothing confidently parses, so callers fall back to per-building
// variation instead of guessing at a mix that wasn't actually specified.
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const NUM_WORD = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)';
function parseEstateMix(description, totalCount) {
  const text = (description || '').toLowerCase();
  const segments = text.split(/\band\b|,|;/);
  const items = [];
  // The count for each segment must sit right next to that segment's own
  // dwelling type (e.g. "four 3-bedroom bungalows"), not just anywhere in
  // the segment — otherwise a leading "8 houses: four bungalows and four
  // duplexes" picks up the overall total (8) as this segment's count
  // instead of "four", and the second type never gets built.
  const pattern = new RegExp(`${NUM_WORD}\\s+(?:(\\d+)\\s*[-\\s]?bed(?:room)?s?\\s+)?(?:[a-z-]+\\s+){0,2}(bungalow|duplex|triplex|two[-\\s]?stor\\w*|single[-\\s]?stor\\w*)`);
  for (const seg of segments) {
    const m = seg.match(pattern);
    if (!m) continue;
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORD_NUM[m[1]];
    if (!n) continue;
    const isDuplex = /duplex|two[-\s]?stor|triplex/.test(m[3]);
    items.push({ count: n, bedrooms: m[2] ? Number(m[2]) : null, floors: isDuplex ? 2 : 1 });
  }
  if (!items.length) return null;
  const queue = [];
  items.forEach((it) => { for (let i = 0; i < it.count; i++) queue.push({ bedrooms: it.bedrooms, floors: it.floors }); });
  // Cycle through the ORIGINAL requested pattern to fill up to totalCount —
  // captured as `originalLength` before the loop specifically because
  // `queue[queue.length % queue.length]` (the previous form of this line)
  // is mathematically always index 0 (n % n is 0 for any n != 0, and queue
  // never reaches 0 length here). That meant a request like "one bungalow
  // and one duplex" filled to 6 produced
  // [bungalow,duplex,bungalow,bungalow,bungalow,bungalow] instead of the
  // intended alternating [bungalow,duplex,bungalow,duplex,bungalow,duplex]
  // — every fill-in house silently defaulted to whichever type was
  // requested first, undermining the one thing this mix parser exists to
  // get right. Verified against both a 2-item and a 3-item pattern before
  // this fix went in, not just reasoned about.
  const originalLength = queue.length;
  while (queue.length < totalCount) queue.push(queue[queue.length % originalLength]);
  return queue.slice(0, totalCount);
}

async function generateEstateBuilding({ description, index, total, override }) {
  const overrideNote = override
    ? ` This specific building (building ${index}) MUST be a ${override.bedrooms ? `${override.bedrooms}-bedroom ` : ''}${override.floors > 1 ? 'duplex/multi-storey home' : 'single-storey bungalow'} — that part of the estate brief is not optional, follow it exactly.`
    : '';
  if (genAI) {
    try {
      const variation = `This is building ${index} of ${total} in a residential estate/compound. Estate brief: "${description}".${overrideNote} Otherwise, give this specific building its own distinct bedroom count/style/features appropriate to the brief — vary it from a "typical" building matching the brief so the estate doesn't look like ${total} identical clones, while staying consistent with the overall estate description.`;
      const parts = [{ text: `You are a professional architectural design assistant generating ONE building within a larger estate project.\n${variation}\n\n${designBriefSchemaInstructions()}` }];
      const text = await callGemini(parts);
      const json = JSON.parse(stripFences(text));
      const brief = clampDesignBrief(
        override ? { ...json.designBrief, bedrooms: override.bedrooms ?? json.designBrief?.bedrooms, floors: override.floors ?? json.designBrief?.floors } : json.designBrief,
        json.title,
      );
      return {
        title: json.title || brief.name,
        category: brief.floors > 1 ? 'duplex' : 'house',
        summary: json.summary || '',
        dimensions: Array.isArray(json.dimensions) ? json.dimensions : [],
        materials: Array.isArray(json.materials) ? json.materials : [],
        modelSpec: { designBrief: brief },
        engine: 'gemini',
      };
    } catch (err) {
      console.error(`Estate building ${index}/${total} generation failed, using offline procedural brief:`, err.message);
    }
  }
  // Offline fallback: derive a brief from the estate description with the
  // same heuristic parser chat uses, then apply the parsed mix override (if
  // any) or a deterministic per-index bedroom-count variation so an estate
  // of N houses is never N identical clones even with no AI available.
  const base = offlineDesignBrief(description);
  const bedrooms = override?.bedrooms ?? clampNumber(base.bedrooms + (((index - 1) % 3) - 1), 1, 10, base.bedrooms);
  const floors = override?.floors ?? base.floors;
  const brief = clampDesignBrief({ ...base, bedrooms, floors, name: null }, null);
  const text = offlineDescriptiveText(brief);
  return {
    title: `${text.title} (House ${index})`,
    category: brief.floors > 1 ? 'duplex' : 'house',
    summary: text.summary,
    dimensions: text.dimensions,
    materials: text.materials,
    modelSpec: { designBrief: brief },
    engine: 'offline',
  };
}

// Small bounded-concurrency helper — keeps several Gemini calls in flight
// at once (faster than fully sequential) without firing all N at once
// (which risks free-tier rate limits on larger estates).
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Reads each building's own generated geometry to get its real footprint
// (bounding box in the X/Z plane), rather than assuming a fixed lot size —
// so the procedural layout below fits the buildings that actually exist.
// A designBrief-based building carries its footprint directly (plus any
// per-floor setback, which can only ever be smaller than the ground floor,
// so the ground-floor footprint is always the widest); the legacy parts
// pipeline still gets its footprint by scanning part bounding boxes.
function computeFootprint(modelSpec) {
  if (modelSpec?.designBrief) {
    const { width, depth } = modelSpec.designBrief.footprint || { width: 10, depth: 8 };
    return { width: Math.max(width, 3), depth: Math.max(depth, 3) };
  }
  const parts = modelSpec?.parts || [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  parts.forEach(p => {
    const [x = 0, , z = 0] = p.position || [0, 0, 0];
    let halfW = 0.5, halfD = 0.5;
    if (p.type === 'cylinder') {
      const r = Math.max(p.radiusTop ?? 0, p.radiusBottom ?? 0, 0.3);
      halfW = r; halfD = r;
    } else if (p.size) {
      halfW = (p.size[0] || 1) / 2;
      halfD = (p.size[2] || 1) / 2;
    }
    minX = Math.min(minX, x - halfW); maxX = Math.max(maxX, x + halfW);
    minZ = Math.min(minZ, z - halfD); maxZ = Math.max(maxZ, z + halfD);
  });
  if (!isFinite(minX)) return { width: 10, depth: 8 };
  return { width: Math.max(maxX - minX, 3), depth: Math.max(maxZ - minZ, 3) };
}

// Subdivision-style estate site plan — row-grid layout style. Superseded
// as the active layout by estatePlanner.js's planEstate() (a single road
// spine with a reserved green space, see generateEstate() below for why),
// but kept defined and fully working — not dead/rotting code, an
// alternate layout style that's one line away from being wired back in as
// a future "layout style" option — rather than deleted outright.
//
// Each plot here is sized to its own building's real footprint plus real
// setbacks (front/side/rear), rows greedily pack as many plots as fit the
// site width so plot sizing genuinely varies by row (a row of bungalows and
// a row of duplexes end up visibly different widths), and every row gets
// its own branch road — real point geometry a viewer can render as an
// actual paved strip, not a decorative floor grid. Plots and roads are
// nested inside the returned `site` object specifically so the existing
// persistence path (estate.js's `site_json: JSON.stringify(result.site)`)
// picks them up automatically with no schema/route change needed.
const PLOT_SIDE_SETBACK = 1.5;  // building clearance from its own plot's side lines
const PLOT_FRONT_SETBACK = 3;   // building clearance from the plot's road-facing line
const PLOT_REAR_SETBACK = 2;    // building clearance from the plot's rear line
const PLOT_SIDE_YARD = 1.5;     // gap between two adjacent plots in the same row
const ESTATE_ROAD_WIDTH = 6;    // branch road width, running in front of each row
const ESTATE_PERIMETER_SETBACK = 4; // clearance between the outermost plots and the compound wall

function layoutEstate(buildings, siteWidthHint, siteDepthHint) {
  if (!buildings.length) {
    return { positions: [], site: { width: siteWidthHint || 20, depth: siteDepthHint || 20, rows: 0, cols: 0, roadWidth: ESTATE_ROAD_WIDTH, plots: [], roads: [] } };
  }

  const plots = buildings.map((b, i) => {
    const footprint = computeFootprint(b.modelSpec);
    return {
      index: i,
      footprint,
      plotWidth: footprint.width + PLOT_SIDE_SETBACK * 2,
      plotDepth: footprint.depth + PLOT_FRONT_SETBACK + PLOT_REAR_SETBACK,
    };
  });

  const widestPlot = Math.max(...plots.map(p => p.plotWidth));
  const usableWidth = Math.max((siteWidthHint || 0) - ESTATE_PERIMETER_SETBACK * 2, widestPlot);

  // Greedy row-fill in the order buildings were given, so a requested mix
  // ("four bungalows then four duplexes") stays grouped roughly the way it
  // was described instead of being re-sorted by size.
  const rows = [];
  let row = [], rowWidth = 0;
  for (const plot of plots) {
    const add = row.length > 0 ? PLOT_SIDE_YARD + plot.plotWidth : plot.plotWidth;
    if (row.length > 0 && rowWidth + add > usableWidth) {
      rows.push(row);
      row = [plot];
      rowWidth = plot.plotWidth;
    } else {
      row.push(plot);
      rowWidth += add;
    }
  }
  if (row.length) rows.push(row);

  const plotResults = new Array(plots.length);
  const roads = [];
  let zCursor = 0, siteWidthUsed = 0;

  rows.forEach((rowPlots) => {
    const thisRowWidth = rowPlots.reduce((sum, p, i) => sum + p.plotWidth + (i > 0 ? PLOT_SIDE_YARD : 0), 0);
    siteWidthUsed = Math.max(siteWidthUsed, thisRowWidth);
    const rowDepth = Math.max(...rowPlots.map(p => p.plotDepth));

    const roadZ = zCursor;
    zCursor += ESTATE_ROAD_WIDTH;
    const rowZ0 = zCursor, rowZ1 = zCursor + rowDepth;

    let x = -thisRowWidth / 2;
    rowPlots.forEach((plot) => {
      const x0 = x, x1 = x + plot.plotWidth;
      x = x1 + PLOT_SIDE_YARD;
      const buildingCenterZ = rowZ0 + PLOT_FRONT_SETBACK + plot.footprint.depth / 2;
      plotResults[plot.index] = {
        plotNumber: `Plot ${String(plot.index + 1).padStart(2, '0')}`,
        boundary: [[x0, rowZ0], [x1, rowZ0], [x1, rowZ1], [x0, rowZ1]],
        buildingPosition: [(x0 + x1) / 2, buildingCenterZ],
        width: Math.round(plot.plotWidth * 100) / 100,
        depth: Math.round(plot.plotDepth * 100) / 100,
      };
    });

    // The branch road serving this row, centered on the road strip
    // in front of it — real line geometry a viewer renders as a paved
    // road, not a placeholder grid.
    roads.push({
      points: [
        [-thisRowWidth / 2 - PLOT_SIDE_YARD / 2, roadZ + ESTATE_ROAD_WIDTH / 2],
        [thisRowWidth / 2 + PLOT_SIDE_YARD / 2, roadZ + ESTATE_ROAD_WIDTH / 2],
      ],
      width: ESTATE_ROAD_WIDTH,
    });

    zCursor = rowZ1;
  });

  const totalDepth = zCursor;
  const totalWidth = siteWidthUsed + PLOT_SIDE_YARD * 2;
  const siteWidth = Math.max(siteWidthHint || 0, totalWidth + ESTATE_PERIMETER_SETBACK * 2);
  const siteDepth = Math.max(siteDepthHint || 0, totalDepth + ESTATE_PERIMETER_SETBACK * 2);

  // Anchor the layout to the compound wall's actual gate position instead
  // of just centering around the origin — buildCompoundWall()
  // (frontend/src/three/skyEnvironment.js) places its default gate
  // ('front' side) at a FIXED point, x=0, z=+siteDepth/2 — verified
  // against that file's own gate-placement math, not assumed to line up.
  // Row 0 (the first building requested) lands nearest the gate, with
  // rows extending straight back into the site from there, the way a real
  // subdivision's road actually starts at the entrance rather than the
  // layout floating independently of where the wall's opening is.
  const gateZ = siteDepth / 2;
  const entryZ = gateZ - ESTATE_PERIMETER_SETBACK; // just inside the gate, before the first road
  const toWorldZ = (localZ) => entryZ - localZ;

  for (const p of plotResults) {
    p.boundary = p.boundary.map(([x, z]) => [x, toWorldZ(z)]);
    p.buildingPosition = [p.buildingPosition[0], toWorldZ(p.buildingPosition[1])];
  }
  for (const r of roads) r.points = r.points.map(([x, z]) => [x, toWorldZ(z)]);

  return {
    positions: plotResults.map(p => ({ x: p.buildingPosition[0], z: p.buildingPosition[1] })),
    site: {
      width: siteWidth,
      depth: siteDepth,
      rows: rows.length,
      cols: Math.max(...rows.map(r => r.length)),
      roadWidth: ESTATE_ROAD_WIDTH,
      plots: plotResults,
      roads,
      gate: { x: 0, z: gateZ },
    },
  };
}

async function generateEstate({ description, buildingCount, siteWidth, siteDepth }) {
  const count = Math.max(1, Math.min(10, Number(buildingCount) || 4));
  const indices = Array.from({ length: count }, (_, i) => i + 1);
  // "8 houses: four 3-bedroom bungalows and four 4-bedroom duplexes" (test
  // case 6 of the rebuild spec) needs an explicit per-building mix, not
  // per-building AI improvisation — parse it once up front so every
  // building request carries the exact override it must follow.
  const mix = parseEstateMix(description, count);
  const buildingResults = await mapWithConcurrency(indices, 3, (i) =>
    generateEstateBuilding({ description, index: i, total: count, override: mix ? mix[i - 1] : null })
  );

  // Phase 5: a single road spine from the compound gate, buildings on
  // individually-sized plots alternating along it, plus a reserved green/
  // amenity space at the far end — see estatePlanner.js. This replaced the
  // earlier row-grid layoutEstate() (still defined above, kept as a
  // reference/fallback layout style, not currently reachable from here) as
  // the active layout: a real subdivision reads as a distinct, memorable
  // site plan, not a parking-lot grid of houses.
  const footprints = buildingResults.map((b) => computeFootprint(b.modelSpec));
  const { positions, site } = planEstate(footprints, Number(siteWidth) || 60, Number(siteDepth) || 60);
  const engine = buildingResults.some(b => b.engine === 'gemini') ? 'gemini' : 'offline';

  const buildings = buildingResults.map((b, i) => ({
    name: b.title || `House ${String(i + 1).padStart(2, '0')}`,
    position: [positions[i].x, positions[i].z],
    rotation: positions[i].rotation || 0,
    category: b.category || 'house',
    summary: b.summary || '',
    dimensions: b.dimensions || [],
    materials: b.materials || [],
    modelSpec: b.modelSpec || { parts: [] },
  }));

  return {
    title: description ? `Estate — ${description.slice(0, 60)}` : 'New Residential Estate',
    summary: `A ${count}-building estate generated from: "${description || 'no brief given'}".`,
    site,
    buildings,
    engine,
  };
}

module.exports = {
  analyzeBlueprint,
  chatDesign,
  generateRenderImage,
  generateCostEstimate,
  generateEstate,
  isOnline: () => Boolean(GEMINI_KEY),
};
