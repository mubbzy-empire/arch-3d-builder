const BASE = '/api';

export async function getHealth() {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error('Health check failed');
  return res.json();
}

export async function analyzeBlueprint(file, notes) {
  const form = new FormData();
  form.append('image', file);
  form.append('notes', notes || '');
  const res = await fetch(`${BASE}/analyze`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Analysis failed');
  }
  return res.json();
}

export async function sendChatMessage(message, history, projectId) {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, projectId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Chat failed');
  }
  return res.json();
}

export async function getCostEstimate(project, budget, location) {
  const res = await fetch(`${BASE}/estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: project.id,
      budget,
      location,
      title: project.title,
      summary: project.summary,
      materials: project.materials,
      equipment: project.equipment,
      dimensions: project.dimensions,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Estimate failed');
  }
  return res.json();
}

export async function listProjects() {
  const res = await fetch(`${BASE}/analyze/projects`);
  if (!res.ok) throw new Error('Could not load projects');
  return res.json();
}

export async function getProject(id) {
  const res = await fetch(`${BASE}/analyze/projects/${id}`);
  if (!res.ok) throw new Error('Could not load project');
  return res.json();
}
