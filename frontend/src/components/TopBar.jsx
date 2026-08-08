import React, { useEffect, useState } from 'react';
import { getHealth } from '../api/client';

export default function TopBar() {
  const [online, setOnline] = useState(null);

  useEffect(() => {
    let mounted = true;
    getHealth()
      .then(d => mounted && setOnline(d.aiEngine === 'gemini'))
      .catch(() => mounted && setOnline(false));
    return () => { mounted = false; };
  }, []);

  return (
    <header className="topbar">
      <div className="mark">
        <span className="dot" />
        Arch-3d build
      </div>
      <div className="status">
        <span className={`led ${online === null ? '' : online ? 'online' : 'offline'}`} />
        {online === null ? 'CONNECTING' : online ? 'AI: GEMINI' : 'AI: OFFLINE ENGINE'}
      </div>
    </header>
  );
}
