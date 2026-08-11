import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { analyzeBlueprint } from '../api/client';
import BlueprintCanvas from '../components/BlueprintCanvas';

export default function Upload() {
  const [source, setSource] = useState('device'); // 'device' | 'draw'
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fromDrawing, setFromDrawing] = useState(false);
  const [notes, setNotes] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const handleFile = useCallback((f, drawn = false) => {
    if (!f || !f.type.startsWith('image/')) {
      setError('Please choose an image file (JPG, PNG, or WEBP).');
      return;
    }
    setError(null);
    setFile(f);
    setFromDrawing(drawn);
    setPreview(URL.createObjectURL(f));
  }, []);

  const handleDrawingUse = useCallback((f) => handleFile(f, true), [handleFile]);

  const chooseDifferent = () => {
    setFile(null);
    setPreview(null);
    setSource(fromDrawing ? 'draw' : 'device');
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  const onSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeBlueprint(file, notes);
      navigate('/results', { state: { result } });
    } catch (err) {
      setError(err.message || 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="screen">
        <div className="eyebrow">Analyzing</div>
        <div className="scan-panel">
          <div className="scan-line" />
          <span className="scan-label">Reading rooms, walls, doors &amp; windows, then drafting the 3D model…</span>
        </div>
        <p className="page-sub" style={{ textAlign: 'center' }}>This can take up to 30-45 seconds for a detailed blueprint — the AI reads the drawing first, then builds geometry to match.</p>
      </div>
    );
  }

  return (
    <div className="screen">
      <div>
        <div className="eyebrow">Blueprint upload</div>
        <h1 className="page-title" style={{ marginTop: 10 }}>Upload a blueprint or structure photo</h1>
        <p className="page-sub" style={{ marginTop: 10 }}>
          Floor plans and elevation drawings with labeled dimensions give the most accurate result.
          A clear photo of an existing structure also works — or sketch one right here.
        </p>
      </div>

      {!preview && (
        <div className="seg-tabs">
          <button className={`seg-tab${source === 'device' ? ' active' : ''}`} onClick={() => setSource('device')}>Upload from device</button>
          <button className={`seg-tab${source === 'draw' ? ' active' : ''}`} onClick={() => setSource('draw')}>Draw a blueprint</button>
        </div>
      )}

      {!preview ? (
        source === 'device' ? (
          <div
            className={`dropzone${dragActive ? ' drag-active' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M12 16V4M12 4l-4 4M12 4l4 4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <b>Tap to choose a file</b>
            <span className="hint">JPG · PNG · WEBP — up to 15MB</span>
            <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </div>
        ) : (
          <BlueprintCanvas onUse={handleDrawingUse} />
        )
      ) : (
        <div className="preview-frame"><img src={preview} alt="Selected upload preview" /></div>
      )}

      {preview && (
        <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', padding: '6px 0' }} onClick={chooseDifferent}>
          {fromDrawing ? 'Redraw' : 'Choose a different file'}
        </button>
      )}

      <div>
        <label className="spec-label" style={{ display: 'block', marginBottom: 8 }}>
          Notes for the AI <span style={{ color: 'var(--text-faint)' }}>(optional)</span>
        </label>
        <textarea rows={3} placeholder="e.g. Scale is 1:100, north-facing entrance, single story…" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 13.5 }}>{error}</p>}

      <button className="btn btn-primary btn-block" disabled={!file} onClick={onSubmit}>Analyze blueprint</button>
    </div>
  );
}
