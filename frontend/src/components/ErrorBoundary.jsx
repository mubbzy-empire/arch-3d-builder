import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Arch-3d build crashed:', error, info);
    this.setState({ info });
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100dvh', display: 'flex', flexDirection: 'column', gap: 16,
          padding: 24, background: '#0a0c0f', color: '#e9ebee', fontFamily: 'monospace',
        }}>
          <div>
            <div style={{ color: '#e2a24d', fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>
              Something crashed — screenshot this whole screen and send it back
            </div>
            <div style={{ fontSize: 15, fontWeight: 'bold', marginBottom: 12 }}>
              {this.state.error?.message || String(this.state.error)}
            </div>
          </div>
          <div style={{
            flex: 1, overflow: 'auto', fontSize: 11, lineHeight: 1.5, color: '#9aa2ad',
            background: '#14171d', border: '1px solid #232830', borderRadius: 8, padding: 12,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {this.state.error?.stack || 'No stack trace available'}
            {this.state.info?.componentStack && (
              <>
                {'\n\n--- Component stack ---'}
                {this.state.info.componentStack}
              </>
            )}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 20px', background: '#e2a24d', color: '#16130a', border: 'none',
              borderRadius: 6, fontWeight: 'bold', fontFamily: 'inherit',
            }}
          >
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
