import React from 'react';
import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from './navItems.jsx';

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.map(item => (
        <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          {item.icon}
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
