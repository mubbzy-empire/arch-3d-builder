import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listProjects } from '../api/client';

export default function Projects() {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    listProjects().then(setProjects).catch(e => setError(e.message));
  }, []);

  return (
    <div className="screen">
      <div>
        <div className="eyebrow">Saved</div>
        <h1 className="page-title" style={{ marginTop: 10 }}>Projects</h1>
        <p className="page-sub" style={{ marginTop: 10 }}>Every design you've generated, stored locally in your database.</p>
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 13.5 }}>{error}</p>}

      {projects && projects.length === 0 && (
        <div className="empty-state">
          <p>No designs yet — upload a blueprint or describe an idea to get started.</p>
          <button className="btn btn-secondary" onClick={() => navigate('/upload')}>Upload a blueprint</button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {projects?.map(p => (
          <div key={p.id} className="project-row" role="button" onClick={() => navigate(`/results/${p.id}`)}>
            <div className="thumb">
              {p.image_path ? <img src={p.image_path} alt="" /> : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 5h16v11H8l-4 4V5z" /></svg>
              )}
            </div>
            <div className="meta">
              <b>{p.title}</b>
              <span>{p.category} · {new Date(p.created_at).toLocaleDateString()}</span>
            </div>
            <span className="badge">{p.source_type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
