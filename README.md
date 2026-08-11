# Arch-3d build

Upload a blueprint (or describe a design in chat) and get:

- An **editable, interactive 3D model** — click any wall, roof section, door, or window
  and drag it with an on-screen gizmo (like Blender) to move it, or switch the gizmo to
  **Rotate** to spin it in place. The interior is hidden behind the roof by default and
  only opens up when you press the **"Show interior"** button — the model itself only
  loads once you press **"View 3D model"**, instead of building automatically
- Real **cut-through doors and windows** (actual holes in the walls, not decals) using
  boolean geometry — including **interior doors that connect one demarcated room to the
  next**, cut into the partition wall between them, not just decorative dividers
- Click any part or room for a quick **info panel** (element type, room, floor, material)
- **Dimensions, materials, equipment, and a build sequence**
- A **budget & cost estimate** — enter a number and get a rough materials/labor/timeline
  range, with the AI attempting a live web-informed estimate when possible
- A **chat design mode** that drafts and colors the architecture automatically (no furniture — this is an architectural modeler, not an interior designer)
- A **photorealistic AI concept render** alongside the interactive model
- **Multi-building estates/compounds** — describe a whole development and get several
  independently-editable buildings placed on a site with a procedural (non-AI, guaranteed
  non-overlapping) road/plot layout, browsable in a Scene Explorer. The site layout
  itself is editable too — drag a building to a new plot or rotate it in place with the
  same gizmo, or drill into one building for full part-level editing
- A **manual 3D modeler** — draw real walls point-to-point, cut real door/window openings
  into them, and place freestanding primitives from a completely empty scene, no AI
  involved, with select/move, undo/redo, and save
- **Version history** on any project — checkpoint the current design under a label and
  restore an earlier one later

Built primarily for **architects and design professionals** — see the in-app disclaimer.
Desktop-optimized (side navigation, split-screen results view) with full mobile support.

Stack: **React + Vite** (frontend), **Node/Express + SQLite** (backend), **Three.js +
three-bvh-csg** (3D rendering and boolean geometry), optional **Google Gemini free-tier
API** for real AI vision/chat/cost reasoning, with a built-in **offline analysis engine**
so the app works with no API key and no cost.

---

## 1. What you need installed first

- **Node.js 18 or newer**: https://nodejs.org (choose "LTS")

That's the only prerequisite — SQLite is embedded, no separate database server needed.

---

## 2. Unzip and install

```bash
cd path/to/archview
npm run install:all
```

---

## 3. (Recommended) Connect a free AI key

Without a key, the app works immediately via a built-in offline engine (rule-based
templates for common building types). For real blueprint reading, room-partitioned
chat design, photorealistic renders, and cost estimates, connect a free Gemini key:

1. https://aistudio.google.com/apikey → sign in → **Create API key** (free, no card).
2. In `archview/backend`, copy `.env.example` to `.env`.
3. Paste your key: `GEMINI_API_KEY=your-key-here` (works with both `AIza...` and `AQ....`
   key formats).
4. Save, then restart the backend if it's already running.

The top bar shows **"AI: GEMINI"** when connected, or **"AI: OFFLINE ENGINE"** when not.

---

## 4. Run it

```bash
npm run dev
```

Starts the backend (`http://localhost:4000`) and frontend (`http://localhost:5173`)
together. Open **http://localhost:5173** in your browser. `Ctrl+C` to stop.

---

## 5. Using the 3D editor

- **Orbit:** drag anywhere on the model to rotate, scroll/pinch to zoom.
- **Edit parts:** tap "Edit parts" in the viewer, then click any wall/roof/door/window/
  part. A 3-axis drag gizmo appears — **Move** drags that part along an axis, **Rotate**
  spins it in place around the same gizmo. Pull a wall or the roof away to see inside.
- **Part info:** tap any part any time (even outside edit mode) to see its element type,
  room, floor, and material in a small overlay panel.
- **Reset positions:** undoes all manual moves/rotations back to the AI's original layout.
- **Interior view:** one-tap roof removal without manual dragging.
- **Color swatches:** below the viewer, recolor walls/roof/door/windows live.
- **Version history:** save a labeled checkpoint any time from the Results page, and
  restore an earlier one later — works for single buildings and whole estates.

---

## 6. Estates / compounds

Go to **Estate** in the nav, describe the whole development (mix of house types, shared
facilities, style — e.g. "10 houses, house 1 is a 4-bed duplex, houses 2-5 are 3-bed
duplexes, houses 6-10 are modern 4-bed homes, add a gatehouse and shared garden"), set
building count and site size, and generate. Each building is generated individually
through the same real-geometry pipeline as a single design; the site layout (grid
positions, road spacing, non-overlap) is placed **procedurally, not by the AI**, so it's
geometrically guaranteed correct regardless of what the AI does with each building's
shape. Use the Scene Explorer to select/hide/focus individual buildings, and tap a
building to open its own editable 3D view below (full part-level editing, same as a
single-building project). To rearrange the site itself, tap **"Edit layout"** in the
estate viewer, then click any building and drag it to a new plot (**Move**) or spin it
(**Rotate**) — constrained to the ground plane so a building can't be lifted into the
air or tipped over. **"Reset layout"** undoes every manual move back to the generated
plot positions.

---

## 7. Manual modeler (no AI)

Go to **Modeler** in the nav to build entirely from scratch: pick the **Wall** tool and
click a start point then an end point to draw a wall; **Door**/**Window** to click an
existing wall and cut a real opening into it; **Box**/**Cylinder** for freestanding
primitives. **Select** lets you click any part and drag it with a gizmo (moving a wall
carries its doors/windows with it). The Properties panel edits size/material/color
numerically; Undo/Redo covers every action; Save writes it as a normal project you can
reopen, edit further, or export to `.glb` like any AI-generated design.

---

## 8. Hosting it online for free

Same process as any Node app on Render — see the in-repo `render.yaml`. Push this
project to a GitHub repo, create a new Web Service on [render.com](https://render.com)
pointing at it (Free instance type), add `GEMINI_API_KEY` as an environment variable in
Render's dashboard, and deploy. Render auto-detects the build/start commands from
`render.yaml`.

Free-tier notes: the instance sleeps after 15 minutes idle (30-60s to wake up on the
next visit), and has no permanent disk, so saved projects/images may reset when the
instance restarts.

---

## 9. Project structure

```
archview/
├── backend/
│   ├── server.js              Express entry point
│   ├── db.js                  SQLite schema (projects, chat_messages, estimates,
│   │                          project_versions, project_buildings)
│   ├── routes/
│   │   ├── analyze.js         Blueprint upload + analysis, project history,
│   │   │                      version history, manual-design save
│   │   ├── chat.js            Chat design (architecture only, no furniture)
│   │   ├── estimate.js        Budget/cost estimate
│   │   └── estate.js          Multi-building estate generation + retrieval
│   ├── services/aiService.js  Gemini integration + offline fallback engine +
│   │                          estate generation/procedural site layout
│   └── .env.example           Copy to .env to add your free Gemini key
├── frontend/
│   └── src/
│       ├── pages/             Home, Upload, Chat, Results, Projects,
│       │                      EstateGenerate, EstateResults, ManualModeler
│       ├── components/
│       │   ├── ModelViewer.jsx      Single-building 3D viewer: gizmo editing, colors
│       │   ├── SceneViewer.jsx      Multi-building estate viewer + Scene Explorer
│       │   ├── PartInfoPanel.jsx    Click-for-details overlay (shared by both viewers)
│       │   ├── BudgetEstimator.jsx  Budget input + cost estimate display
│       │   ├── Disclaimer.jsx       Architect-use disclaimer banner
│       │   ├── SideNav.jsx          Desktop navigation
│       │   └── BottomNav.jsx        Mobile navigation
│       ├── three/buildParts.js      Shared CSG wall/opening/mesh-building engine
│       ├── api/client.js
│       └── index.css                Design system (dark, professional, responsive)
├── render.yaml
└── package.json
```

---

## 10. Honest limitations to know about

- **Blueprint reading is best-effort, not exact.** The AI reads labeled dimensions and
  room layout as precisely as it can, but a hand-drawn or low-quality scan won't produce
  a pixel-perfect twin — treat results as an accurate concept, not a surveyed duplicate.
- **Cost estimates are AI-generated approximations**, not quotes. The app attempts real
  Google Search grounding for current pricing when a key is connected; when that's
  unavailable it falls back to AI reasoning, then to a simple offline formula. Always
  labeled clearly which mode produced a given estimate — always get local contractor
  quotes before committing to a number.
- **The 3D model is built from primitives** (boxes/cylinders) assembled by the AI or by
  hand, not a full architectural CAD engine — it's an accurate-to-scale concept model you
  can edit, not a construction-ready structural document.
- **Estate site layout is procedural, not engineered, but is manually adjustable.**
  Generated placement/road spacing is guaranteed non-overlapping by the grid math;
  dragging a building in "Edit layout" mode does not re-check for overlaps against
  its new spot, so keep an eye on it visually. Drainage, utilities, grading, and actual
  civil/site engineering are not modeled — that still needs a licensed engineer.
- **Manual-modeler wall rotate has one known gap:** rotating a freestanding box/cylinder
  with the gizmo works cleanly, but rotating a wall does not carry its attached
  doors/windows around with it (only a translate move does) — delete/re-place openings
  if you need to rotate a wall significantly.
- **Free-tier Gemini models get renamed/retired periodically** — if AI features stop
  working, check `backend/services/aiService.js` for the model name comments and
  https://ai.google.dev/gemini-api/docs/models for the current equivalent.

## 11. Troubleshooting

- **"Cannot find module" errors** → run `npm run install:all` from the root.
- **Port already in use** → change `PORT` in `backend/.env` and the proxy in
  `frontend/vite.config.js` to match.
- **AI features erroring** → check your key in `backend/.env`, or remove it to fall back
  to the offline engine.
- **3D viewer blank or oddly shaped** → click "Reset positions" in the viewer controls;
  if it persists, the AI's generated part list may be malformed — try regenerating.
