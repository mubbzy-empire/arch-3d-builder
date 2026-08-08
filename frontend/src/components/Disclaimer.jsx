import React from 'react';

export default function Disclaimer({ text }) {
  return (
    <div className="disclaimer-banner">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
      </svg>
      <p>
        <b>Built for architect and design-professional use.</b> {text || 'AI-generated concepts, quantities, and cost estimates are a starting point for early design conversations — not a substitute for licensed architectural, structural, or contractor review, and not a construction-ready document.'}
      </p>
    </div>
  );
}
