import React from 'react';
import { Routes, Route } from 'react-router-dom';
import TopBar from './components/TopBar';
import BottomNav from './components/BottomNav';
import SideNav from './components/SideNav';
import Home from './pages/Home';
import Upload from './pages/Upload';
import Chat from './pages/Chat';
import Results from './pages/Results';
import Projects from './pages/Projects';
import EstateGenerate from './pages/EstateGenerate';
import EstateResults from './pages/EstateResults';
import ManualModeler from './pages/ManualModeler';

export default function App() {
  return (
    <div className="app-shell">
      <SideNav />
      <div className="app-main">
        <TopBar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/results" element={<Results />} />
          <Route path="/results/:id" element={<Results />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/estate" element={<EstateGenerate />} />
          <Route path="/estate/:id" element={<EstateResults />} />
          <Route path="/modeler" element={<ManualModeler />} />
        </Routes>
        <BottomNav />
      </div>
    </div>
  );
}
