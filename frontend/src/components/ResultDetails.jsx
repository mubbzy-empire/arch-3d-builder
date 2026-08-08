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
