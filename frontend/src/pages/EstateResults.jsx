import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import SceneViewer from '../components/SceneViewer';
import ModelViewer from '../components/ModelViewer';
import { DimensionsCard, MaterialsCard } from '../components/ResultDetails';
import Disclaimer from '../components/Disclaimer';
import { getEstate, listProjectVersions, saveProjectVersion, restoreProjectVersion } from '../api/client';

export default function EstateResults() {
  const location = useLocation();
  const params = useParams();
  const navigate = useNavigate();
  const [estate, setEstate] = useState(location.state?.estate || null);
  const [loading, setLoading] = useState(!location.state?.estate && !!params.id);
  const [error, setError] = useState(null);
  const [focusedBuilding, setFocusedBuilding] = useState(null);
  const [versions, setVersions] = useState([]);
  const [versionLabel, setVersionLabel] = useState('');
  const [savingVersion, setSavingVersion] = useState(false);

  useEffect(() => {
    if (!estate && params.id) {
      setLoading(true);
      getEstate(params.id).then(setEstate).catch(e => setError(e.message)).finally(() => setLoading(false));
    }
  }, [params.id]);

  useEffect(() => {
    if (params.id) {
      listProjectVersions(params.id).then(setVersions).catch(() => {});
    }
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
      const fresh = await getEstate(params.id);
      setEstate(fresh);
      setFocusedBuilding(null);
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="screen">
        <div className="scan-panel"><div className="scan-line" /><span className="scan-label">Loading estate…</span></div>
      </div>
    );
  }

  if (error || !estate) {
    return (
      <div className="screen">
        <div className="empty-state">
          <p>{error || 'No estate to show yet.'}</p>
          <button className="btn btn-secondary" onClick={() => navigate('/estate')}>Generate an estate</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div>
        <div className="eyebrow">estate · {estate.buildings?.length || 0} buildings</div>
        <h1 className="page-title" style={{ marginTop: 10 }}>{estate.title}</h1>
        {estate.summary && <p className="page-sub" style={{ marginTop: 10 }}>{estate.summary}</p>}
      </div>

      <SceneViewer site={estate.site} buildings={estate.buildings} onFocusBuilding={setFocusedBuilding} />

      {focusedBuilding && (
        <div className="panel bracket">
          <div className="section-head">
            <h3>{focusedBuilding.name}</h3>
            <span className="count">{focusedBuilding.category}</span>
          </div>
          {focusedBuilding.summary && <p className="page-sub" style={{ marginBottom: 12 }}>{focusedBuilding.summary}</p>}
          <ModelViewer modelSpec={focusedBuilding.modelSpec} title={focusedBuilding.name} />
          <div className="split-layout" style={{ marginTop: 14 }}>
            <div className="split-main">
              <DimensionsCard dimensions={focusedBuilding.dimensions} />
            </div>
            <div className="split-side">
              <MaterialsCard materials={focusedBuilding.materials} />
            </div>
          </div>
        </div>
      )}

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
            {savingVersion ? 'Saving…' : 'Save version'}
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

      <Disclaimer text="This estate layout is procedurally arranged for geometric correctness (non-overlapping plots, road access) — actual site engineering, drainage, and utilities design require a licensed civil engineer." />

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => navigate('/estate')}>New estate</button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => navigate('/projects')}>Back to projects</button>
      </div>
    </div>
  );
}
