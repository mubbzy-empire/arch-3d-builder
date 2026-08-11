import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateEstate } from '../api/client';

export default function EstateGenerate() {
  const [description, setDescription] = useState('');
  const [buildingCount, setBuildingCount] = useState(4);
  const [siteWidth, setSiteWidth] = useState(60);
  const [siteDepth, setSiteDepth] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const onSubmit = async () => {
    if (!description.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await generateEstate({ description, buildingCount, siteWidth, siteDepth });
      navigate(`/estate/${result.id}`, { state: { estate: result } });
    } catch (err) {
      setError(err.message || 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="screen">
        <div className="eyebrow">Generating estate</div>
        <div className="scan-panel">
          <div className="scan-line" />
          <span className="scan-label">Drafting {buildingCount} buildings &amp; laying out the site…</span>
        </div>
        <p className="page-sub" style={{ textAlign: 'center' }}>
          Each building is generated individually, then placed on the site with a procedural, non-overlapping road grid. This can take a minute or two for larger estates.
        </p>
      </div>
    );
  }

  return (
    <div className="screen">
      <div>
        <div className="eyebrow">Estate / compound</div>
        <h1 className="page-title" style={{ marginTop: 10 }}>Generate a multi-building estate</h1>
        <p className="page-sub" style={{ marginTop: 10 }}>
          Describe the whole development — mix of house types, shared facilities, style. Each building gets its own real geometry;
          the site layout (roads, spacing, non-overlap) is placed procedurally so the estate stays geometrically correct.
        </p>
      </div>

      <div>
        <label className="spec-label" style={{ display: 'block', marginBottom: 8 }}>Estate brief</label>
        <textarea
          rows={5}
          placeholder='e.g. "10 houses on a 3-acre site. House 1 is a 4-bedroom duplex, houses 2-5 are 3-bedroom duplexes, houses 6-10 are modern 4-bedroom homes. Add a security gatehouse feel and a shared recreational garden."'
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 140px' }}>
          <label className="spec-label" style={{ display: 'block', marginBottom: 8 }}>Number of buildings</label>
          <input type="number" min={1} max={10} value={buildingCount} onChange={(e) => setBuildingCount(Number(e.target.value))} />
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <label className="spec-label" style={{ display: 'block', marginBottom: 8 }}>Site width (m)</label>
          <input type="number" min={20} max={500} value={siteWidth} onChange={(e) => setSiteWidth(Number(e.target.value))} />
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <label className="spec-label" style={{ display: 'block', marginBottom: 8 }}>Site depth (m)</label>
          <input type="number" min={20} max={500} value={siteDepth} onChange={(e) => setSiteDepth(Number(e.target.value))} />
        </div>
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 13.5 }}>{error}</p>}

      <button className="btn btn-primary btn-block" disabled={!description.trim()} onClick={onSubmit}>
        Generate estate ({buildingCount} buildings)
      </button>
    </div>
  );
}
