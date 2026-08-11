import React from 'react';

export function DimensionsCard({ dimensions = [] }) {
  if (!dimensions.length) return null;
  return (
    <div className="panel bracket">
      <div className="section-head"><h3>Dimensions</h3><span className="count">{dimensions.length} specs</span></div>
      {dimensions.map((d, i) => (
        <div className="spec-row" key={i}><span className="spec-label">{d.label}</span><span className="spec-value">{d.value}</span></div>
      ))}
    </div>
  );
}

export function MaterialsCard({ materials = [] }) {
  if (!materials.length) return null;
  return (
    <div className="panel bracket">
      <div className="section-head"><h3>Materials</h3><span className="count">{materials.length} items</span></div>
      {materials.map((m, i) => (
        <div className="list-item" key={i}>
          <span className="idx">{String(i + 1).padStart(2, '0')}</span>
          <div className="body"><b>{m.name}</b>{m.purpose && <span>{m.purpose}</span>}</div>
        </div>
      ))}
    </div>
  );
}

export function EquipmentCard({ equipment = [] }) {
  if (!equipment.length) return null;
  return (
    <div className="panel bracket">
      <div className="section-head"><h3>Equipment needed</h3><span className="count">{equipment.length} tools</span></div>
      {equipment.map((eq, i) => (
        <div className="list-item" key={i}>
          <span className="idx">{String(i + 1).padStart(2, '0')}</span>
          <div className="body"><b>{eq.name}</b>{eq.note && <span>{eq.note}</span>}</div>
        </div>
      ))}
    </div>
  );
}

export function StepsCard({ steps = [] }) {
  if (!steps.length) return null;
  return (
    <div className="panel bracket">
      <div className="section-head"><h3>Build sequence</h3><span className="count">{steps.length} steps</span></div>
      {steps.map((s, i) => (
        <div className="list-item" key={i}>
          <span className="idx">{String(i + 1).padStart(2, '0')}</span>
          <div className="body"><b style={{ fontWeight: 500 }}>{s}</b></div>
        </div>
      ))}
    </div>
  );
}

// What the AI actually read off the uploaded drawing, before it generated
// any 3D geometry — a distinct reading step from a distinct Gemini call, so
// this is a record of recognition, not of the 3D output. Only rendered for
// blueprint uploads (chat/manual/estate projects have no drawing to read).
export function DetectedElementsCard({ detected }) {
  if (!detected) return null;
  const isOffline = detected.source === 'offline';
  const roomCount = detected.rooms?.length || 0;
  const doorCount = detected.doors?.length || 0;
  const windowCount = detected.windows?.length || 0;

  return (
    <div className="panel bracket">
      <div className="section-head">
        <h3>What the AI read from your drawing</h3>
        <span className="count">{isOffline ? 'estimated' : `${roomCount + doorCount + windowCount} elements`}</span>
      </div>

      {isOffline && (
        <p className="page-sub" style={{ fontSize: 12.5, marginBottom: 12 }}>
          No live AI connection was available, so your drawing wasn't actually read — this is a
          generic layout from the offline engine, not a reading of your specific file.
        </p>
      )}

      <div className="spec-row"><span className="spec-label">Floors detected</span><span className="spec-value">{detected.floors ?? 1}</span></div>
      {detected.scaleNote && <div className="spec-row"><span className="spec-label">Scale / dimensions</span><span className="spec-value" style={{ textAlign: 'right', maxWidth: '65%' }}>{detected.scaleNote}</span></div>}
      {detected.stairs != null && <div className="spec-row"><span className="spec-label">Staircase</span><span className="spec-value">{detected.stairs ? 'Yes' : 'No'}</span></div>}
      {detected.walls && (
        <div className="spec-row">
          <span className="spec-label">Walls</span>
          <span className="spec-value">{detected.walls.exterior ?? '—'} exterior · {detected.walls.interior ?? '—'} interior</span>
        </div>
      )}

      {roomCount > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 14 }}><h3 style={{ fontSize: 13 }}>Rooms ({roomCount})</h3></div>
          {detected.rooms.map((r, i) => (
            <div className="list-item" key={i}>
              <span className="idx">{String(i + 1).padStart(2, '0')}</span>
              <div className="body">
                <b>{r.name}{detected.floors > 1 ? ` · Floor ${r.floor ?? 1}` : ''}</b>
                {r.notes && <span>{r.notes}</span>}
              </div>
            </div>
          ))}
        </>
      )}

      {doorCount > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 14 }}><h3 style={{ fontSize: 13 }}>Doors ({doorCount})</h3></div>
          {detected.doors.map((d, i) => (
            <div className="list-item" key={i}>
              <span className="idx">{String(i + 1).padStart(2, '0')}</span>
              <div className="body"><b style={{ fontWeight: 500 }}>{d.location}</b></div>
            </div>
          ))}
        </>
      )}

      {windowCount > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 14 }}><h3 style={{ fontSize: 13 }}>Windows ({windowCount})</h3></div>
          {detected.windows.map((w, i) => (
            <div className="list-item" key={i}>
              <span className="idx">{String(i + 1).padStart(2, '0')}</span>
              <div className="body"><b style={{ fontWeight: 500 }}>{w.location}</b></div>
            </div>
          ))}
        </>
      )}

      {detected.uncertain?.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 14 }}><h3 style={{ fontSize: 13 }}>Unclear on the drawing</h3></div>
          {detected.uncertain.map((u, i) => (
            <p key={i} className="page-sub" style={{ fontSize: 12.5, marginTop: 4 }}>{u}</p>
          ))}
        </>
      )}
    </div>
  );
}
