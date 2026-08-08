import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { sendChatMessage } from '../api/client';

const WELCOME = {
  role: 'assistant',
  content: "Describe the space you want designed — for example \"a modern three-bedroom house with an open kitchen and large living-room windows.\" I'll furnish and color it, then draft dimensions, materials, equipment, and a 3D model you can edit.",
};

export default function Chat() {
  const location = useLocation();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [projectId, setProjectId] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (location.state?.seed) setInput(`Refine "${location.state.seed}": `);
  }, [location.state]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const nextHistory = [...messages, { role: 'user', content: text }];
    setMessages(nextHistory);
    setInput('');
    setSending(true);
    try {
      const { reply, result, projectId: pid } = await sendChatMessage(text, messages, projectId);
      if (pid) setProjectId(pid);
      setMessages([...nextHistory, { role: 'assistant', content: reply, result }]);
    } catch (err) {
      setMessages([...nextHistory, { role: 'assistant', content: `Something went wrong: ${err.message}` }]);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="screen" style={{ paddingBottom: 'calc(var(--nav-height) + 90px)' }}>
      <div>
        <div className="eyebrow">Describe &amp; design</div>
        <h1 className="page-title" style={{ marginTop: 10 }}>Chat</h1>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.role === 'assistant' && <div className="eyebrow">Arch-3d build</div>}
            <p>{m.content}</p>
            {m.result && (
              <button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => navigate('/results', { state: { result: { ...m.result, engine: m.result.engine || 'gemini' } } })}>
                View 3D design →
              </button>
            )}
          </div>
        ))}
        {sending && (
          <div className="bubble assistant">
            <div className="eyebrow">Arch-3d build</div>
            <p style={{ color: 'var(--text-muted)' }}>Furnishing and drafting a concept…</p>
          </div>
        )}
      </div>

      <div className="chat-input-bar">
        <textarea rows={1} placeholder="Describe the space you want designed…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} />
        <button className="icon-btn" disabled={!input.trim() || sending} onClick={send} aria-label="Send message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12l16-8-6 8 6 8-16-8z" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </div>
  );
}
