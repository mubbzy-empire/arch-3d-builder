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
- "interior": a floor slab per story, PLUS mandatory partition walls that physically divide the floor into distinct enclosed rooms — this is the single most important part of a good response, do not skip or minimize it. First mentally list the rooms this floor needs (a home needs, at minimum: one living/parlor room, one kitchen, one bathroom/toilet, and one bedroom per bedroom described — plus a dining area, garage, or terrace if mentioned), then output real partition wall boxes that physically separate every one of those rooms from its neighbors (walls on at least 2-3 sides per room, not a single line down the middle). A floor with fewer than (room count − 1) × 2 partition wall parts is not acceptable. Tag each with the "room" it belongs to (e.g. "Parlor", "Kitchen", "Toilet", "Bedroom 1", "Garage") and the correct "floor". Do NOT populate rooms with furniture or decor — this application models architecture only (walls, openings, floors, roof); leave every room as clean, empty, correctly-proportioned floor space. Do not use a "furniture" group at all.
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
// simple room grid so the viewer always shows real room demarcation rather
// than one open box. This app models architecture only — clean, empty,
// correctly-proportioned rooms — never furniture/decor. Only runs for live
// Gemini output (never touches the hand-authored offline templates), and
// only adds to floors the AI left essentially unplanned.
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
    if (existingRooms.size >= 3) return; // AI already planned real rooms for this floor — leave it alone

    const [w, h, d] = envelope.size;
    const [cx, cy, cz] = envelope.position || [0, h / 2, 0];
    const baseY = cy - h / 2;
    const thickness = 0.08;
    // Full floor-to-ceiling partitions (minus a hair of clearance at the
    // slab and ceiling line) — the old 0.85x height left partitions visibly
    // short of the ceiling, which is what made them read as "dividers"
    // rather than real walls.
    const wallH = Math.max(0.4, h - 0.2);
    const wallY = baseY + wallH / 2;

    const area = w * d;
    const cols = area > 70 ? 3 : 2;
    const rows = area > 45 ? 2 : 1;
    const colW = w / cols;
    const rowD = d / rows;

    for (let c = 1; c < cols; c++) {
      const x = cx - w / 2 + colW * c;
      spec.parts.push({ type: 'box', size: [thickness, wallH, d], position: [x, wallY, cz], material: 'wood', color: '#eef0ea', group: 'interior', room: 'auto', floor: floorNum });
      spec.parts.push({ type: 'box', size: [0.85, 2.0, thickness * 3], position: [x, baseY + 1.0, cz - d / 2 + d * 0.3], material: 'wood', color: '#6b4a2f', group: 'interior-door', floor: floorNum });
      addedAny = true;
    }
    for (let r = 1; r < rows; r++) {
      const z = cz - d / 2 + rowD * r;
      spec.parts.push({ type: 'box', size: [w, wallH, thickness], position: [cx, wallY, z], material: 'wood', color: '#eef0ea', group: 'interior', room: 'auto', floor: floorNum });
      spec.parts.push({ type: 'box', size: [0.85, 2.0, thickness * 3], position: [cx - w / 2 + w * 0.3, baseY + 1.0, z], material: 'wood', color: '#6b4a2f', group: 'interior-door', floor: floorNum });
      addedAny = true;
    }
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
    modelSpec: { parts: [
      { type: 'box', size: [10, 3.2, 8], position: [0, 1.6, 0], material: 'wood', color: '#a9d3ea', group: 'structure' },
      { type: 'cylinder', radiusTop: 0.001, radiusBottom: 7.2, height: 1.8, position: [0, 4.1, 0], material: 'metal', color: '#243447', group: 'roof' },
      { type: 'box', size: [1.2, 1.2, 0.05], position: [-2.5, 1.8, 4.02], material: 'glass', group: 'window' },
      { type: 'box', size: [1.2, 1.2, 0.05], position: [2.5, 1.8, 4.02], material: 'glass', group: 'window' },
      { type: 'box', size: [0.05, 1.2, 1.2], position: [-5.02, 1.8, -1], material: 'glass', group: 'window' },
      { type: 'box', size: [0.05, 1.2, 1.2], position: [5.02, 1.8, 1.5], material: 'glass', group: 'window' },
      { type: 'box', size: [0.9, 2.05, 0.05], position: [0, 1.025, 4.02], material: 'wood', color: '#3f6fa0', group: 'door' },
      { type: 'box', size: [9.6, 0.05, 7.6], position: [0, 0.03, 0], material: 'wood', color: '#c9b28a', group: 'interior' },
      { type: 'box', size: [0.05, 3.0, 7.6], position: [-2, 1.6, 0], material: 'wood', group: 'interior' },
      { type: 'box', size: [0.05, 3.0, 7.6], position: [2, 1.6, 0], material: 'wood', group: 'interior' },
      { type: 'box', size: [0.85, 2.0, 0.15], position: [-2, 1.025, -2.5], material: 'wood', color: '#6b4a2f', group: 'interior-door' },
      { type: 'box', size: [0.85, 2.0, 0.15], position: [2, 1.025, 1.5], material: 'wood', color: '#6b4a2f', group: 'interior-door' },
    ] },
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
    modelSpec: { parts: [
      // Ground floor (y 0 → 3)
      { type: 'box', size: [10, 3, 8], position: [0, 1.5, 0], material: 'wood', color: '#bcdcee', group: 'structure', floor: 1 },
      { type: 'box', size: [1.2, 1.3, 0.05], position: [-3.3, 1.55, 4.02], material: 'glass', group: 'window', floor: 1 },
      { type: 'box', size: [1.2, 1.3, 0.05], position: [1.7, 1.55, 4.02], material: 'glass', group: 'window', floor: 1 },
      { type: 'box', size: [0.05, 1.3, 1.3], position: [-5.02, 1.55, -1.2], material: 'glass', group: 'window', floor: 1 },
      { type: 'box', size: [0.05, 1.3, 1.3], position: [5.02, 1.55, 1.6], material: 'glass', group: 'window', floor: 1 },
      { type: 'box', size: [1.3, 1.3, 0.05], position: [0, 1.55, -4.02], material: 'glass', group: 'window', floor: 1 },
      { type: 'box', size: [0.95, 2.05, 0.05], position: [-0.9, 1.025, 4.02], material: 'wood', color: '#6b4a2f', group: 'door', floor: 1 },
      { type: 'box', size: [9.6, 0.05, 7.6], position: [0, 0.03, 0], material: 'wood', color: '#c9b28a', group: 'interior', floor: 1 },
      { type: 'box', size: [0.06, 2.8, 7.6], position: [-1.5, 1.43, 0], material: 'wood', color: '#eef0ea', group: 'interior', floor: 1, room: 'Living Room' },
      { type: 'box', size: [6.5, 2.8, 0.06], position: [1.75, 1.43, 1.5], material: 'wood', color: '#eef0ea', group: 'interior', floor: 1, room: 'Kitchen' },
      { type: 'box', size: [0.85, 2.0, 0.15], position: [-1.5, 1.0, 2.0], material: 'wood', color: '#6b4a2f', group: 'interior-door', floor: 1 },
      { type: 'box', size: [0.85, 2.0, 0.15], position: [0.0, 1.0, 1.5], material: 'wood', color: '#6b4a2f', group: 'interior-door', floor: 1 },
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
      { type: 'box', size: [0.06, 2.8, 7.6], position: [0.3, 4.43, 0], material: 'wood', color: '#f2f0e6', group: 'interior', floor: 2, room: 'Bedroom 1' },
      { type: 'box', size: [4.7, 2.8, 0.06], position: [2.65, 4.43, 0], material: 'wood', color: '#f2f0e6', group: 'interior', floor: 2, room: 'Bedroom 2' },
      { type: 'box', size: [0.85, 2.0, 0.15], position: [0.3, 4.0, -2.0], material: 'wood', color: '#6b4a2f', group: 'interior-door', floor: 2 },
      { type: 'box', size: [0.85, 2.0, 0.15], position: [1.0, 4.0, 0.0], material: 'wood', color: '#6b4a2f', group: 'interior-door', floor: 2 },
      // Roof atop the upper floor
      { type: 'cylinder', radiusTop: 0.001, radiusBottom: 7.3, height: 2.1, position: [0, 7.05, 0], material: 'metal', color: '#243447', group: 'roof', floor: 2 },
    ] },
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

async function analyzeBlueprint({ base64, mimeType, fileName, notes }) {
  if (genAI) {
    let detected = null;
    try {
      detected = await detectBlueprintElements({ base64, mimeType, notes });
    } catch (err) {
      console.error('Blueprint element detection failed, generating without a grounded reading:', err.message);
    }

    try {
      const groundedText = detected
        ? `You are a professional architect's assistant. You already read this exact drawing and identified the following elements on it:\n${JSON.stringify(detected)}\nNow reconstruct it as an accurate to-scale 3D design that matches EXACTLY what you identified above: one "structure" envelope per floor listed, one partitioned, named "interior" room (with a connecting "interior-door" opening) for every entry in "rooms", one opening for every entry in "doors" (a door described as an entrance/exterior becomes group "door"; a door described as connecting two named rooms becomes group "interior-door"), and one "window" opening for every entry in "windows". Look at the image again for the real proportions, wall positions, and which rooms are actually adjacent to each other — position everything to match the actual layout shown, don't arrange rooms arbitrarily. Do not add rooms, doors, or windows beyond what was identified above unless the notes below ask for something extra.`
        : `You are a professional architect's assistant. The uploaded image is likely a floor plan, blueprint, elevation drawing, or a photo of a building/structure. Read any labeled dimensions, room names, wall lines, door/window markers, and scale indicators as precisely as possible, and reconstruct them as an accurate to-scale 3D design — prioritize matching the real proportions and layout shown over creative interpretation. Do not invent furniture or decor that isn't indicated in the source.`;
      const parts = [
        { text: `${groundedText} ${notes ? `Architect's notes: ${notes}.` : ''}\n${schemaInstructions()}` },
        { inlineData: { mimeType, data: base64 } },
      ];
      const text = await callGemini(parts);
      const json = reinforceDesign(JSON.parse(stripFences(text)));
      return { ...json, detected, engine: 'gemini' };
    } catch (err) {
      console.error('Gemini blueprint analysis failed, falling back to offline engine:', err.message);
    }
  }
  const offline = offlineDesign(notes, fileName);
  return { ...offline, detected: detectedFromOffline(offline), engine: 'offline' };
}

async function chatDesign({ message, history }) {
  if (genAI) {
    try {
      const convo = (history || []).map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n');
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

async function generateEstateBuilding({ description, index, total }) {
  if (genAI) {
    try {
      const variation = `This is building ${index} of ${total} in a residential estate/compound. Estate brief: "${description}". Give this specific building its own distinct footprint, room count, and roofline appropriate to the brief — vary its size/bedroom count/style slightly from a "typical" building matching the brief so the estate doesn't look like ${total} identical clones, while staying consistent with the overall estate description and any per-house instructions in it (e.g. "houses 2-5 should be 3-bedroom duplexes").`;
      const parts = [{ text: `You are a professional architectural design assistant generating ONE building within a larger estate project.\n${variation}\n\n${schemaInstructions()}` }];
      const text = await callGemini(parts);
      const json = reinforceDesign(JSON.parse(stripFences(text)));
      return { ...json, engine: 'gemini' };
    } catch (err) {
      console.error(`Estate building ${index}/${total} generation failed, using offline template:`, err.message);
    }
  }
  // Offline fallback: cycle a house template with a per-index scale variation
  // so buildings in the estate are still visually distinguishable from
  // each other, clearly labeled as offline/procedural (never claimed as AI).
  const offline = offlineDesign(description, '');
  const scale = 0.82 + ((index - 1) % 5) * 0.09;
  const scaled = JSON.parse(JSON.stringify(offline));
  scaled.title = `${offline.title} (variant ${index})`;
  scaled.modelSpec.parts = (scaled.modelSpec.parts || []).map(p => ({
    ...p,
    size: p.size ? p.size.map(v => v * scale) : p.size,
    radiusTop: p.radiusTop != null ? p.radiusTop * scale : p.radiusTop,
    radiusBottom: p.radiusBottom != null ? p.radiusBottom * scale : p.radiusBottom,
    height: p.type === 'cylinder' && p.height != null ? p.height * scale : p.height,
    position: p.position ? p.position.map(v => v * scale) : p.position,
  }));
  return { ...scaled, engine: 'offline' };
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
function computeFootprint(modelSpec) {
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

// Deterministic grid placement with a fixed road-width gap between every
// building on both axes. Guarantees zero footprint overlap by construction.
function layoutEstate(buildings, siteWidth, siteDepth) {
  const ROAD_GAP = 6;
  const SETBACK = 3;
  const footprints = buildings.map(b => computeFootprint(b.modelSpec));
  const cellW = Math.max(...footprints.map(f => f.width), 6) + ROAD_GAP;
  const cellD = Math.max(...footprints.map(f => f.depth), 6) + ROAD_GAP;
  const usableWidth = Math.max((siteWidth || 0) - SETBACK * 2, cellW);
  const cols = Math.max(1, Math.min(buildings.length, Math.floor(usableWidth / cellW) || 1));
  const rows = Math.ceil(buildings.length / cols);

  const positions = buildings.map((_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      x: -((cols - 1) * cellW) / 2 + col * cellW,
      z: -((rows - 1) * cellD) / 2 + row * cellD,
    };
  });

  return {
    positions,
    site: {
      width: Math.max(siteWidth || 0, cols * cellW + SETBACK * 2),
      depth: Math.max(siteDepth || 0, rows * cellD + SETBACK * 2),
      cols, rows, roadGap: ROAD_GAP,
    },
  };
}

async function generateEstate({ description, buildingCount, siteWidth, siteDepth }) {
  const count = Math.max(1, Math.min(10, Number(buildingCount) || 4));
  const indices = Array.from({ length: count }, (_, i) => i + 1);
  const buildingResults = await mapWithConcurrency(indices, 3, (i) =>
    generateEstateBuilding({ description, index: i, total: count })
  );

  const { positions, site } = layoutEstate(buildingResults, Number(siteWidth) || 60, Number(siteDepth) || 60);
  const engine = buildingResults.some(b => b.engine === 'gemini') ? 'gemini' : 'offline';

  const buildings = buildingResults.map((b, i) => ({
    name: b.title || `House ${String(i + 1).padStart(2, '0')}`,
    position: [positions[i].x, positions[i].z],
    rotation: 0,
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
