import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import ModelViewer from '../components/ModelViewer';
import { DimensionsCard, EquipmentCard, MaterialsCard, StepsCard, DetectedElementsCard } from '../components/ResultDetails';
import BudgetEstimator from '../components/BudgetEstimator';
import Disclaimer from '../components/Disclaimer';
import { getProject, listProjectVersions, saveProjectVersion, restoreProjectVersion } from '../api/client';

export default function Results() {
  const location = useLocation();
  const params = useParams();
  const navigate = useNavigate();
  const [result, setResult] = useState(location.state?.result || null);
  const [loading, setLoading] = useState(!location.state?.result && !!params.id);
  const [error, setError] = useState(null);
  const [versions, setVersions] = useState([]);
  const [versionLabel, setVersionLabel] = useState('');
  const [savingVersion, setSavingVersion] = useState(false);

  useEffect(() => {
    if (!result && params.id) {
      setLoading(true);
      getProject(params.id)
        .then(p => setResult({
          id: p.id, title: p.title, category: p.category, summary: p.summary,
          dimensions: p.dimensions, materials: p.materials, equipment: p.equipment,
          modelSpec: p.modelSpec, imagePath: p.image_path, renderImagePath: p.renderImagePath,
          detected: p.detected, engine: 'saved',
        }))
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [params.id]);

  useEffect(() => {
    if (params.id) listProjectVersions(params.id).then(setVersions).catch(() => {});
  }, [params.id]);

  const saveVersion = async () => {
    if (!params.id) return;
    setSavingVersion(true);
    try {
      const v = await saveProjectVersion(params.id, versionLabel);
      setVersions(list => [v, ...list]);
      setVersionLabel('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingVersion(false);
    }
  };

  const restoreVersion = async (versionId) => {
    if (!params.id) return;
    try {
      await restoreProjectVersion(params.id, versionId);
      const p = await getProject(params.id);
      setResult({
        id: p.id, title: p.title, category: p.category, summary: p.summary,
        dimensions: p.dimensions, materials: p.materials, equipment: p.equipment,
        modelSpec: p.modelSpec, imagePath: p.image_path, renderImagePath: p.renderImagePath,
        detected: p.detected, engine: 'saved',
      });
    } catch (err) {
      setError(err.message);
    }
  };

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

          {result.imagePath && (
            <div className="panel bracket" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 14px 0' }}>
                <span className="eyebrow">Your uploaded blueprint</span>
              </div>
              <img src={result.imagePath} alt="Uploaded blueprint" style={{ display: 'block', width: '100%', marginTop: 10 }} />
              <p className="page-sub" style={{ padding: '10px 14px 14px', fontSize: 12.5 }}>
                Compare this against the "What the AI read" panel to check the reading against your actual drawing.
              </p>
            </div>
          )}

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
          <DetectedElementsCard detected={result.detected} />
          <DimensionsCard dimensions={result.dimensions} />
          <MaterialsCard materials={result.materials} />
          <EquipmentCard equipment={result.equipment} />
          <StepsCard steps={result.steps} />
          <BudgetEstimator project={result} />

          <button className="btn btn-secondary btn-block" onClick={exportDetails}>Export project details (.json)</button>

          {result.id && (
            <div className="panel bracket">
              <div className="section-head"><h3>Version history</h3><span className="count">{versions.length} saved</span></div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  type="text"
                  placeholder="Label this checkpoint (optional)"
                  value={versionLabel}
                  onChange={(e) => setVersionLabel(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-secondary" onClick={saveVersion} disabled={savingVersion}>
                  {savingVersion ? 'Saving…' : 'Save'}
                </button>
              </div>
              {versions.length === 0 && <p className="page-sub" style={{ fontSize: 12.5 }}>No checkpoints saved yet.</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {versions.map(v => (
                  <div key={v.id} className="version-row">
                    <div className="meta">
                      <b>{v.label}</b>
                      <span>{new Date(v.created_at).toLocaleString()}</span>
                    </div>
                    <button className="btn btn-ghost" onClick={() => restoreVersion(v.id)}>Restore</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => navigate('/chat', { state: { seed: result.title } })}>Refine in chat</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => navigate('/upload')}>New design</button>
          </div>
        </div>
      </div>
    </div>
  );
}
