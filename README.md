# Arch-3d build

Upload a blueprint (or describe a design in chat) and get:

- An **editable, interactive 3D model** — click any wall, roof section, door, window, or
  furniture piece and drag it with an on-screen gizmo (like Blender) to reposition it or
  pull it away to reveal the interior
- Real **cut-through doors and windows** (actual holes in the walls, not decals) using
  boolean geometry
- **Dimensions, materials, equipment, and a build sequence**
- A **budget & cost estimate** — enter a number and get a rough materials/labor/timeline
  range, with the AI attempting a live web-informed estimate when possible
- A **chat design mode** that furnishes and colors interiors automatically
- A **photorealistic AI concept render** alongside the interactive model

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
templates for common building/furniture types). For real blueprint reading, furnished
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
  furniture piece. A 3-axis drag gizmo appears — drag an arrow to move that part along
  that axis. Pull a wall or the roof away to see inside.
- **Reset positions:** undoes all manual moves back to the AI's original layout.
- **Interior view:** one-tap roof removal without manual dragging.
- **Color swatches:** below the viewer, recolor walls/roof/door/windows/furniture live.

---

## 6. Hosting it online for free

Same process as any Node app on Render — see the in-repo `render.yaml`. Push this
project to a GitHub repo, create a new Web Service on [render.com](https://render.com)
pointing at it (Free instance type), add `GEMINI_API_KEY` as an environment variable in
Render's dashboard, and deploy. Render auto-detects the build/start commands from
`render.yaml`.

Free-tier notes: the instance sleeps after 15 minutes idle (30-60s to wake up on the
next visit), and has no permanent disk, so saved projects/images may reset when the
instance restarts.

---

## 7. Project structure

```
archview/
├── backend/
│   ├── server.js              Express entry point
│   ├── db.js                  SQLite schema (projects, chat_messages, estimates)
│   ├── routes/
│   │   ├── analyze.js         Blueprint upload + analysis, project history
│   │   ├── chat.js            Chat design (furnished)
│   │   └── estimate.js        Budget/cost estimate
│   ├── services/aiService.js  Gemini integration + offline fallback engine
│   └── .env.example           Copy to .env to add your free Gemini key
├── frontend/
│   └── src/
│       ├── pages/             Home, Upload, Chat, Results, Projects
│       ├── components/
│       │   ├── ModelViewer.jsx      3D viewer: CSG walls, gizmo editing, colors
│       │   ├── BudgetEstimator.jsx  Budget input + cost estimate display
│       │   ├── Disclaimer.jsx       Architect-use disclaimer banner
│       │   ├── SideNav.jsx          Desktop navigation
│       │   └── BottomNav.jsx        Mobile navigation
│       ├── api/client.js
│       └── index.css                Design system (dark, professional, responsive)
├── render.yaml
└── package.json
```

---

## 8. Honest limitations to know about

- **Blueprint reading is best-effort, not exact.** The AI reads labeled dimensions and
  room layout as precisely as it can, but a hand-drawn or low-quality scan won't produce
  a pixel-perfect twin — treat results as an accurate concept, not a surveyed duplicate.
- **Cost estimates are AI-generated approximations**, not quotes. The app attempts real
  Google Search grounding for current pricing when a key is connected; when that's
  unavailable it falls back to AI reasoning, then to a simple offline formula. Always
  labeled clearly which mode produced a given estimate — always get local contractor
  quotes before committing to a number.
- **The 3D model is built from primitives** (boxes/cylinders) assembled by the AI, not a
  full architectural CAD engine — it's an accurate-to-scale concept model you can edit,
  not a construction-ready structural document.
- **Free-tier Gemini models get renamed/retired periodically** — if AI features stop
  working, check `backend/services/aiService.js` for the model name comments and
  https://ai.google.dev/gemini-api/docs/models for the current equivalent.

## 9. Troubleshooting

- **"Cannot find module" errors** → run `npm run install:all` from the root.
- **Port already in use** → change `PORT` in `backend/.env` and the proxy in
  `frontend/vite.config.js` to match.
- **AI features erroring** → check your key in `backend/.env`, or remove it to fall back
  to the offline engine.
- **3D viewer blank or oddly shaped** → click "Reset positions" in the viewer controls;
  if it persists, the AI's generated part list may be malformed — try regenerating.
