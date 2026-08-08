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
      INSERT INTO projects (id, title, source_type, image_path, prompt, category, summary, dimensions_json, materials_json, equipment_json, model_spec_json, render_image_path)
      VALUES (@id, @title, 'blueprint', @image_path, @prompt, @category, @summary, @dimensions_json, @materials_json, @equipment_json, @model_spec_json, @render_image_path)
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
  });
});

module.exports = router;
