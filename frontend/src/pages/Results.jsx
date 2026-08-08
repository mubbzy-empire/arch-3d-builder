import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import ModelViewer from '../components/ModelViewer';
import { DimensionsCard, EquipmentCard, MaterialsCard, StepsCard } from '../components/ResultDetails';
import BudgetEstimator from '../components/BudgetEstimator';
import Disclaimer from '../components/Disclaimer';
import { getProject } from '../api/client';

export default function Results() {
  const location = useLocation();
  const params = useParams();
  const navigate = useNavigate();
  const [result, setResult] = useState(location.state?.result || null);
  const [loading, setLoading] = useState(!location.state?.result && !!params.id);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!result && params.id) {
      setLoading(true);
      getProject(params.id)
        .then(p => setResult({
          id: p.id, title: p.title, category: p.category, summary: p.summary,
          dimensions: p.dimensions, materials: p.materials, equipment: p.equipment,
          modelSpec: p.modelSpec, imagePath: p.image_path, renderImagePath: p.renderImagePath, engine: 'saved',
        }))
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [params.id]);

  const exportDetails = () => {
    const payload = {
      title: result.title, category: result.category, summary: result.summary,
      dimensions: result.dimensions, materials: result.materials,
      equipment: result.equipment, steps: result.steps, modelSpec: result.modelSpec,
      exportedFrom: 'Arch-3d build', exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(result.title || 'archvision-project').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };


  if (loading) {
    return (
      <div className="screen">
        <div className="scan-panel"><div className="scan-line" /><span className="scan-label">Loading project…</span></div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="screen">
        <div className="empty-state">
          <p>{error || 'No design to show yet.'}</p>
          <button className="btn btn-secondary" onClick={() => navigate('/upload')}>Start a new design</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div>
        <div className="eyebrow">
          {result.category || 'concept'} · {result.engine === 'gemini' ? 'AI-generated' : result.engine === 'saved' ? 'saved project' : 'offline engine'}
        </div>
        <h1 className="page-title" style={{ marginTop: 10 }}>{result.title || 'Untitled design'}</h1>
        {result.summary && <p className="page-sub" style={{ marginTop: 10 }}>{result.summary}</p>}
      </div>

      <div className="split-layout">
        <div className="split-main">
          <ModelViewer modelSpec={result.modelSpec} />

          {result.renderImagePath && (
            <div className="panel bracket" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 14px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="eyebrow">AI concept render</span>
                <a href={result.renderImagePath} download className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }}>Download image</a>
              </div>
              <img src={result.renderImagePath} alt={`Photorealistic concept render of ${result.title || 'the design'}`} style={{ display: 'block', width: '100%', marginTop: 10 }} />
              <p className="page-sub" style={{ padding: '10px 14px 14px', fontSize: 12.5 }}>
                AI-generated stylized visualization — a design reference, not an exact match to the editable 3D model above.
              </p>
            </div>
          )}

          <Disclaimer />
        </div>

        <div className="split-side">
          <DimensionsCard dimensions={result.dimensions} />
          <MaterialsCard materials={result.materials} />
          <EquipmentCard equipment={result.equipment} />
          <StepsCard steps={result.steps} />
          <BudgetEstimator project={result} />

          <button className="btn btn-secondary btn-block" onClick={exportDetails}>Export project details (.json)</button>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => navigate('/chat', { state: { seed: result.title } })}>Refine in chat</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => navigate('/upload')}>New design</button>
          </div>
        </div>
      </div>
    </div>
  );
}
