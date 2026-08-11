const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { analyzeBlueprint, generateRenderImage, isOnline } = require('../services/aiService');
const { saveRenderImage, uploadDir } = require('../utils/saveImage');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are accepted'));
    cb(null, true);
  },
});

router.get('/status', (_req, res) => {
  res.json({ online: isOnline() });
});

router.post('/', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    const notes = req.body.notes || '';
    const imageBuffer = fs.readFileSync(req.file.path);
    const base64 = imageBuffer.toString('base64');

    const result = await analyzeBlueprint({
      base64,
      mimeType: req.file.mimetype,
      fileName: req.file.originalname,
      notes,
    });

    const renderImage = await generateRenderImage({
      title: result.title, summary: result.summary, materials: result.materials,
    });
    const renderImagePath = saveRenderImage(renderImage);

    const id = uuidv4();
    const relativeImagePath = `/uploads/${path.basename(req.file.path)}`;

    db.prepare(`
      INSERT INTO projects (id, title, source_type, image_path, prompt, category, summary, dimensions_json, materials_json, equipment_json, model_spec_json, render_image_path, detected_json)
      VALUES (@id, @title, 'blueprint', @image_path, @prompt, @category, @summary, @dimensions_json, @materials_json, @equipment_json, @model_spec_json, @render_image_path, @detected_json)
    `).run({
      id,
      title: result.title || 'Untitled Design',
      image_path: relativeImagePath,
      prompt: notes,
      category: result.category || 'generic',
      summary: result.summary || '',
      dimensions_json: JSON.stringify(result.dimensions || []),
      materials_json: JSON.stringify(result.materials || []),
      equipment_json: JSON.stringify(result.equipment || []),
      model_spec_json: JSON.stringify(result.modelSpec || { parts: [] }),
      render_image_path: renderImagePath,
      detected_json: JSON.stringify(result.detected || null),
    });

    res.json({
      id,
      imagePath: relativeImagePath,
      renderImagePath,
      engine: result.engine,
      title: result.title,
      category: result.category,
      summary: result.summary,
      dimensions: result.dimensions,
      materials: result.materials,
      equipment: result.equipment,
      steps: result.steps || [],
      modelSpec: result.modelSpec,
      detected: result.detected || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

router.get('/projects', (_req, res) => {
  const rows = db.prepare('SELECT id, title, source_type, image_path, category, summary, created_at FROM projects ORDER BY created_at DESC LIMIT 50').all();
  res.json(rows);
});

router.get('/projects/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({
    ...row,
    dimensions: JSON.parse(row.dimensions_json || '[]'),
    materials: JSON.parse(row.materials_json || '[]'),
    equipment: JSON.parse(row.equipment_json || '[]'),
    modelSpec: JSON.parse(row.model_spec_json || '{"parts":[]}'),
    renderImagePath: row.render_image_path || null,
    detected: row.detected_json ? JSON.parse(row.detected_json) : null,
  });
});

// ---------------------------------------------------------------------------
// Version history — checkpoint the current scene (single building or, for
// estate projects, all buildings + site) under a label, list checkpoints,
// and restore one back onto the live project row.
// ---------------------------------------------------------------------------

router.post('/projects/:id/versions', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });

  const label = (req.body?.label || '').trim() || `Version ${new Date().toLocaleString()}`;
  let buildingsJson = null;
  if (project.source_type === 'estate') {
    const rows = db.prepare('SELECT * FROM project_buildings WHERE project_id = ? ORDER BY sort_order ASC').all(project.id);
    buildingsJson = JSON.stringify(rows.map(r => ({
      id: r.id, name: r.name, position: [r.position_x, r.position_z], rotation: r.rotation,
      category: r.category, summary: r.summary,
      dimensions: JSON.parse(r.dimensions_json || '[]'), materials: JSON.parse(r.materials_json || '[]'),
      modelSpec: JSON.parse(r.model_spec_json || '{"parts":[]}'),
    })));
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO project_versions (id, project_id, label, model_spec_json, buildings_json, site_json)
    VALUES (@id, @project_id, @label, @model_spec_json, @buildings_json, @site_json)
  `).run({
    id,
    project_id: project.id,
    label,
    model_spec_json: project.model_spec_json || null,
    buildings_json: buildingsJson,
    site_json: project.site_json || null,
  });

  const saved = db.prepare('SELECT id, label, created_at FROM project_versions WHERE id = ?').get(id);
  res.json(saved);
});

router.get('/projects/:id/versions', (req, res) => {
  const rows = db.prepare('SELECT id, label, created_at FROM project_versions WHERE project_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(rows);
});

router.post('/projects/:id/versions/:versionId/restore', (req, res) => {
  const version = db.prepare('SELECT * FROM project_versions WHERE id = ? AND project_id = ?').get(req.params.versionId, req.params.id);
  if (!version) return res.status(404).json({ error: 'Version not found' });
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  if (project.source_type === 'estate' && version.buildings_json) {
    const restoredBuildings = JSON.parse(version.buildings_json);
    const del = db.prepare('DELETE FROM project_buildings WHERE project_id = ?');
    const insert = db.prepare(`
      INSERT INTO project_buildings (id, project_id, name, sort_order, position_x, position_z, rotation, category, summary, dimensions_json, materials_json, model_spec_json)
      VALUES (@id, @project_id, @name, @sort_order, @position_x, @position_z, @rotation, @category, @summary, @dimensions_json, @materials_json, @model_spec_json)
    `);
    const restoreTx = db.transaction((rows) => {
      del.run(project.id);
      rows.forEach((b, i) => insert.run({
        id: b.id || uuidv4(),
        project_id: project.id,
        name: b.name,
        sort_order: i,
        position_x: b.position?.[0] || 0,
        position_z: b.position?.[1] || 0,
        rotation: b.rotation || 0,
        category: b.category || 'house',
        summary: b.summary || '',
        dimensions_json: JSON.stringify(b.dimensions || []),
        materials_json: JSON.stringify(b.materials || []),
        model_spec_json: JSON.stringify(b.modelSpec || { parts: [] }),
      }));
    });
    restoreTx(restoredBuildings);
    if (version.site_json) db.prepare('UPDATE projects SET site_json = ? WHERE id = ?').run(version.site_json, project.id);
  } else if (version.model_spec_json) {
    db.prepare('UPDATE projects SET model_spec_json = ? WHERE id = ?').run(version.model_spec_json, project.id);
  }

  res.json({ restored: true, versionId: version.id });
});

router.post('/manual', (req, res) => {
  try {
    const { title, parts } = req.body;
    if (!Array.isArray(parts)) return res.status(400).json({ error: 'parts array is required' });

    const id = uuidv4();
    db.prepare(`
      INSERT INTO projects (id, title, source_type, category, summary, model_spec_json)
      VALUES (@id, @title, 'manual', 'manual', @summary, @model_spec_json)
    `).run({
      id,
      title: title || 'Untitled manual design',
      summary: 'Built from scratch in the manual 3D modeler — no AI involved.',
      model_spec_json: JSON.stringify({ parts }),
    });

    res.json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Save failed' });
  }
});

module.exports = router;
