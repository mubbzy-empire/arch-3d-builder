import React from 'react';

const MATERIAL_LABELS = {
  wood: 'Wood', metal: 'Metal', glass: 'Glass', fabric: 'Fabric',
  // Architecture-engine material kinds (materialSystem.js)
  plaster: 'Painted Plaster', 'painted-plaster': 'Painted Plaster', concrete: 'Concrete',
  'exposed-concrete': 'Exposed Concrete', brick: 'Brick', stone: 'Stone', aluminium: 'Aluminium',
  tile: 'Tile', marble: 'Marble', 'wood-flooring': 'Wood Flooring', ceramic: 'Ceramic', ceiling: 'Ceiling',
  glazing: 'Glazing', door: 'Door', 'sliding-door': 'Sliding Door', 'garage-door': 'Garage Door', 'french-door': 'French Door',
};

export default function PartInfoPanel({ info, onClose }) {
  if (!info) return null;
  const roomName = info.room && info.room !== 'auto' ? info.room : (info.room === 'auto' ? 'Room' : null);

  return (
    <div className="part-info-panel">
      <button className="part-info-close" onClick={onClose} aria-label="Close">×</button>
      <div className="eyebrow">{info.buildingName ? info.buildingName : 'Selected part'}</div>
      <b style={{ fontSize: 15 }}>{roomName || info.label}</b>
      <div className="part-info-rows">
        {roomName && <span>Element: {info.label}</span>}
        <span>Floor: {info.floor}</span>
        {info.material && <span>Material: {MATERIAL_LABELS[info.material] || info.material}</span>}
        {info.assembly && <span>Assembly: {info.assembly}</span>}
      </div>
      {info.assemblyLayers && info.assemblyLayers.length > 0 && (
        <div className="part-info-layers">
          <div className="eyebrow" style={{ marginTop: 6 }}>Construction (outside → in)</div>
          <ul>
            {info.assemblyLayers.map((layer, i) => (
              <li key={i}>
                {Math.round(layer.thickness * 1000)}mm — {layer.material.replace(/-/g, ' ')}
                {layer.role ? ` (${layer.role})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
