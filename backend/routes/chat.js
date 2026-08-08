const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { chatDesign, generateRenderImage } = require('../services/aiService');
const { saveRenderImage } = require('../utils/saveImage');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { message, history, projectId } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });

    const { reply, result } = await chatDesign({ message, history });

    let savedProjectId = projectId || null;
    if (result && result.modelSpec) {
      const renderImage = await generateRenderImage({
        title: result.title, summary: result.summary, materials: result.materials,
      });
      const renderImagePath = saveRenderImage(renderImage);
      result.renderImagePath = renderImagePath;

      savedProjectId = uuidv4();
      db.prepare(`
        INSERT INTO projects (id, title, source_type, prompt, category, summary, dimensions_json, materials_json, equipment_json, model_spec_json, render_image_path)
        VALUES (@id, @title, 'chat', @prompt, @category, @summary, @dimensions_json, @materials_json, @equipment_json, @model_spec_json, @render_image_path)
      `).run({
        id: savedProjectId,
        title: result.title || 'Untitled Design',
        prompt: message,
        category: result.category || 'generic',
        summary: result.summary || '',
        dimensions_json: JSON.stringify(result.dimensions || []),
        materials_json: JSON.stringify(result.materials || []),
        equipment_json: JSON.stringify(result.equipment || []),
        model_spec_json: JSON.stringify(result.modelSpec || { parts: [] }),
        render_image_path: renderImagePath,
      });
    }

    db.prepare('INSERT INTO chat_messages (id, project_id, role, content) VALUES (?, ?, ?, ?)').run(uuidv4(), savedProjectId, 'user', message);
    db.prepare('INSERT INTO chat_messages (id, project_id, role, content) VALUES (?, ?, ?, ?)').run(uuidv4(), savedProjectId, 'assistant', reply);

    res.json({ reply, projectId: savedProjectId, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Chat failed' });
  }
});

module.exports = router;
