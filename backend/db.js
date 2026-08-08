const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'archvision.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_type TEXT NOT NULL,           -- 'blueprint' | 'chat'
    image_path TEXT,
    prompt TEXT,
    category TEXT,
    summary TEXT,
    dimensions_json TEXT,
    materials_json TEXT,
    equipment_json TEXT,
    model_spec_json TEXT,
    render_image_path TEXT,
    status TEXT DEFAULT 'ready',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    role TEXT NOT NULL,                  -- 'user' | 'assistant'
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS estimates (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    budget REAL,
    location TEXT,
    currency TEXT,
    materials_low REAL,
    materials_high REAL,
    labor_low REAL,
    labor_high REAL,
    timeline_text TEXT,
    grounded INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );
`);

// Migration guards for databases created before a feature existed. Safe to
// run every startup — SQLite errors if the column already exists, ignored.
for (const stmt of [
  'ALTER TABLE projects ADD COLUMN render_image_path TEXT',
  'ALTER TABLE estimates ADD COLUMN location TEXT',
  'ALTER TABLE estimates ADD COLUMN currency TEXT',
]) {
  try { db.exec(stmt); } catch (e) { /* already exists */ }
}

module.exports = db;
