import React from 'react';

const MATERIAL_LABELS = { wood: 'Wood', metal: 'Metal', glass: 'Glass', fabric: 'Fabric' };

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
      </div>
    </div>
  );
}
