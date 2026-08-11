import React, { useEffect, useRef, useState } from 'react';

const STROKE_WIDTHS = { thin: 2, medium: 3.5, thick: 6 };

/**
 * A simple sketch surface for drawing a floor plan by hand: freehand pen for
 * quick sketches, a straight-line tool for walls, and an eraser. Drawing
 * happens on a transparent top canvas; a separate bottom canvas only renders
 * a decorative dot grid so the person has something to draw against without
 * that grid leaking into the exported image.
 */
export default function BlueprintCanvas({ onUse }) {
  const stackRef = useRef(null);
  const gridCanvasRef = useRef(null);
  const drawCanvasRef = useRef(null);
  const undoStackRef = useRef([]);
  const drawingRef = useRef(false);
  const startPointRef = useRef(null);
  const snapshotRef = useRef(null);

  const [tool, setTool] = useState('line'); // 'line' | 'pen' | 'eraser'
  const [width, setWidth] = useState('medium');
  const [canUndo, setCanUndo] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  const getCtx = (ref) => ref.current?.getContext('2d');

  const sizeCanvases = () => {
    const stack = stackRef.current;
    if (!stack) return;
    const { clientWidth: w, clientHeight: h } = stack;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    [gridCanvasRef.current, drawCanvasRef.current].forEach((c) => {
      if (!c) return;
      c.width = w * dpr;
      c.height = h * dpr;
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    drawGrid(w, h);
  };

  const drawGrid = (w, h) => {
    const ctx = getCtx(gridCanvasRef);
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(120, 110, 90, 0.35)';
    const step = 24;
    for (let x = step; x < w; x += step) {
      for (let y = step; y < h; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  useEffect(() => {
    sizeCanvases();
    const onResize = () => sizeCanvases();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushUndo = () => {
    const c = drawCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    undoStackRef.current = [...undoStackRef.current.slice(-19), ctx.getImageData(0, 0, c.width, c.height)];
    setCanUndo(true);
  };

  const undo = () => {
    const c = drawCanvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !undoStackRef.current.length) return;
    const prev = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.putImageData(prev, 0, 0);
    setCanUndo(undoStackRef.current.length > 0);
    setIsEmpty(false);
  };

  const clearAll = () => {
    const c = drawCanvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    pushUndo();
    ctx.clearRect(0, 0, c.width, c.height);
    setIsEmpty(true);
  };

  const localPoint = (e) => {
    const rect = drawCanvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const strokeCtx = () => {
    const ctx = getCtx(drawCanvasRef);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = STROKE_WIDTHS[width] * 4;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#1c1a16';
      ctx.lineWidth = STROKE_WIDTHS[width];
    }
    return ctx;
  };

  const onPointerDown = (e) => {
    e.target.setPointerCapture?.(e.pointerId);
    pushUndo();
    drawingRef.current = true;
    setIsEmpty(false);
    const p = localPoint(e);
    startPointRef.current = p;
    const ctx = strokeCtx();
    if (tool === 'line') {
      snapshotRef.current = ctx.getImageData(0, 0, drawCanvasRef.current.width, drawCanvasRef.current.height);
    } else {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
  };

  const onPointerMove = (e) => {
    if (!drawingRef.current) return;
    const p = localPoint(e);
    const ctx = strokeCtx();
    if (tool === 'line') {
      ctx.putImageData(snapshotRef.current, 0, 0);
      ctx.beginPath();
      ctx.moveTo(startPointRef.current.x, startPointRef.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else {
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  };

  const endStroke = () => { drawingRef.current = false; };

  const handleUse = () => {
    const draw = drawCanvasRef.current;
    if (!draw) return;
    const out = document.createElement('canvas');
    out.width = draw.width;
    out.height = draw.height;
    const octx = out.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(draw, 0, 0);
    out.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], 'hand-drawn-blueprint.png', { type: 'image/png' });
      onUse(file);
    }, 'image/png', 0.95);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="draw-shell">
        <div className="draw-stack" ref={stackRef}>
          <canvas ref={gridCanvasRef} />
          <canvas
            ref={drawCanvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
            onPointerCancel={endStroke}
          />
        </div>
      </div>

      <div className="draw-toolbar">
        <button className={tool === 'line' ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => setTool('line')}>Straight wall</button>
        <button className={tool === 'pen' ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => setTool('pen')}>Freehand</button>
        <button className={tool === 'eraser' ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => setTool('eraser')}>Eraser</button>
        <span className="spec-label">Weight</span>
        <input type="range" min="0" max="2" step="1"
          value={['thin', 'medium', 'thick'].indexOf(width)}
          onChange={(e) => setWidth(['thin', 'medium', 'thick'][Number(e.target.value)])} />
        <button className="btn btn-ghost" onClick={undo} disabled={!canUndo}>Undo</button>
        <button className="btn btn-ghost" onClick={clearAll} disabled={isEmpty}>Clear</button>
      </div>

      <p className="page-sub" style={{ fontSize: 12.5 }}>
        Use "Straight wall" to drag out each wall line, then switch to Freehand for anything irregular.
        Mark doors and windows with a short label or symbol if you can — the AI reads the sketch the same
        way it reads a scanned blueprint.
      </p>

      <button className="btn btn-primary btn-block" disabled={isEmpty} onClick={handleUse}>
        Use this drawing
      </button>
    </div>
  );
}
