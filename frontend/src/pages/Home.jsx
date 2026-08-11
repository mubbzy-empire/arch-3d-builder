import React from 'react';
import { useNavigate } from 'react-router-dom';
import Disclaimer from '../components/Disclaimer';

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="screen">
      <div>
        <div className="eyebrow">Blueprint → 3D</div>
        <h1 className="page-title" style={{ marginTop: 10 }}>
          Turn a blueprint or a description into an editable 3D design.
        </h1>
        <p className="page-sub" style={{ marginTop: 10 }}>
          Upload a floor plan or elevation drawing, or describe a space in chat.
          Arch-3d build returns a to-scale, editable 3D model — click any wall, roof
          panel, door, or window and drag it to explore the layout —
          plus dimensions, materials, equipment, and a budget estimate.
        </p>
      </div>

      <Disclaimer />

      <div className="desktop-grid-2">
        <div className="panel bracket" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="section-head" style={{ marginBottom: 0 }}><h3>Start from a blueprint</h3></div>
          <p className="page-sub">Upload a floor plan, elevation drawing, or photo of a structure.</p>
          <button className="btn btn-primary btn-block" onClick={() => navigate('/upload')}>Upload a blueprint</button>
        </div>

        <div className="panel bracket" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="section-head" style={{ marginBottom: 0 }}><h3>Start from a description</h3></div>
          <p className="page-sub">Describe the design in chat — the AI drafts and colors the architecture for you.</p>
          <button className="btn btn-secondary btn-block" onClick={() => navigate('/chat')}>Open chat</button>
        </div>
      </div>

      <div>
        <div className="section-head">
          <h3 style={{ color: 'var(--text-muted)', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-mono)' }}>How it works</h3>
        </div>
        <div className="panel" style={{ padding: 0 }}>
          {[
            ['01', 'Upload or describe', 'Add a blueprint/photo, or type what you have in mind.'],
            ['02', 'AI design pass', 'The model reads dimensions and drafts a full 3D spec.'],
            ['03', 'Explore and edit', 'Click any part to select it, then drag to move it and reveal the interior.'],
            ['04', 'Budget check', 'Enter a budget for a rough materials, labor, and timeline estimate.'],
          ].map(([n, t, d], i, arr) => (
            <div key={n} style={{ display: 'flex', gap: 14, padding: '14px 18px', borderBottom: i < arr.length - 1 ? '1px solid var(--border-soft)' : 'none' }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-text)', fontSize: 12, paddingTop: 2 }}>{n}</span>
              <div><b style={{ fontSize: 14 }}>{t}</b><p className="page-sub" style={{ marginTop: 2 }}>{d}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
