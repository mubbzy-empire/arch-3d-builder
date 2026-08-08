require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const analyzeRoute = require('./routes/analyze');
const chatRoute = require('./routes/chat');
const estimateRoute = require('./routes/estimate');
const { isOnline } = require('./services/aiService');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', aiEngine: isOnline() ? 'gemini' : 'offline' });
});

app.use('/api/analyze', analyzeRoute);
app.use('/api/chat', chatRoute);
app.use('/api/estimate', estimateRoute);

// Serve the built frontend (if present) so the whole app is a single
// deployable service — no separate frontend host needed.
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Arch-3d build API running on http://localhost:${PORT}`);
  console.log(`AI engine: ${isOnline() ? 'Gemini (online)' : 'Offline built-in engine (no API key set)'}`);
});
