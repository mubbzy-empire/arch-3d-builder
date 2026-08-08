const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { generateCostEstimate } = require('../services/aiService');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { projectId, budget, location, title, summary, materials, equipment, dimensions } = req.body;

    const estimate = await generateCostEstimate({
      title, summary, materials, equipment, dimensions, location,
      budget: budget ? Number(budget) : null,
    });

    if (projectId) {
      db.prepare(`
        INSERT INTO estimates (id, project_id, budget, location, currency, materials_low, materials_high, labor_low, labor_high, timeline_text, grounded, notes)
        VALUES (@id, @project_id, @budget, @location, @currency, @materials_low, @materials_high, @labor_low, @labor_high, @timeline_text, @grounded, @notes)
      `).run({
        id: uuidv4(),
        project_id: projectId,
        budget: budget ? Number(budget) : null,
        location: location || null,
        currency: estimate.currency || null,
        materials_low: estimate.materialsLow ?? null,
        materials_high: estimate.materialsHigh ?? null,
        labor_low: estimate.laborLow ?? null,
        labor_high: estimate.laborHigh ?? null,
        timeline_text: estimate.timeline || null,
        grounded: estimate.grounded ? 1 : 0,
        notes: `${estimate.budgetNote || ''} ${estimate.notes || ''}`.trim(),
      });
    }

    res.json(estimate);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Estimate failed' });
  }
});

module.exports = router;
