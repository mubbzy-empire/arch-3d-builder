const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { generateEstate } = require('../services/aiService');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { description, buildingCount, siteWidth, siteDepth } = req.body;
    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'A description of the estate is required' });
    }

    const result = await generateEstate({
      description,
      buildingCount: Number(buildingCount) || 4,
      siteWidth: Number(siteWidth) || 60,
      siteDepth: Number(siteDepth) || 60,
    });

    const projectId = uuidv4();
    db.prepare(`
      INSERT INTO projects (id, title, source_type, prompt, category, summary, site_json)
      VALUES (@id, @title, 'estate', @prompt, 'estate', @summary, @site_json)
    `).run({
      id: projectId,
      title: result.title,
      prompt: description,
      summary: result.summary,
      site_json: JSON.stringify(result.site),
    });

    const insertBuilding = db.prepare(`
      INSERT INTO project_buildings (id, project_id, name, sort_order, position_x, position_z, rotation, category, summary, dimensions_json, materials_json, model_spec_json)
      VALUES (@id, @project_id, @name, @sort_order, @position_x, @position_z, @rotation, @category, @summary, @dimensions_json, @materials_json, @model_spec_json)
    `);

    const savedBuildings = result.buildings.map((b, i) => {
      const id = uuidv4();
      insertBuilding.run({
        id,
        project_id: projectId,
        name: b.name,
        sort_order: i,
        position_x: b.position[0],
        position_z: b.position[1],
        rotation: b.rotation || 0,
        category: b.category,
        summary: b.summary,
        dimensions_json: JSON.stringify(b.dimensions || []),
        materials_json: JSON.stringify(b.materials || []),
        model_spec_json: JSON.stringify(b.modelSpec || { parts: [] }),
      });
      return { id, ...b };
    });

    res.json({
      id: projectId,
      title: result.title,
      summary: result.summary,
      site: result.site,
      buildings: savedBuildings,
      engine: result.engine,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Estate generation failed' });
  }
});

router.get('/:id', (req, res) => {
  const project = db.prepare(`SELECT * FROM projects WHERE id = ? AND source_type = 'estate'`).get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });

  const rows = db.prepare(`SELECT * FROM project_buildings WHERE project_id = ? ORDER BY sort_order ASC`).all(req.params.id);
  const buildings = rows.map(r => ({
    id: r.id,
    name: r.name,
    position: [r.position_x, r.position_z],
    rotation: r.rotation,
    category: r.category,
    summary: r.summary,
    dimensions: JSON.parse(r.dimensions_json || '[]'),
    materials: JSON.parse(r.materials_json || '[]'),
    modelSpec: JSON.parse(r.model_spec_json || '{"parts":[]}'),
  }));

  res.json({
    id: project.id,
    title: project.title,
    summary: project.summary,
    prompt: project.prompt,
    site: JSON.parse(project.site_json || '{}'),
    buildings,
    createdAt: project.created_at,
  });
});

module.exports = router;
