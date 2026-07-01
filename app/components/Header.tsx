'use client';

import { useTheme } from '../context/ThemeContext';

interface HeaderProps {
  onLogout: () => void;
  onMenuClick: () => void;
}

export function Header({ onLogout, onMenuClick }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="topbar">
      <div className="topbar-logo" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg fill="none" viewBox="0 0 43 30" overflow="visible" focusable="false" height="26">
          <path fill="#D51317" d="M2.148 10.495H12.89c1.052 0 1.847.334 2.16 1.83.348 1.663.203 2.821-1.669 2.953l-3.372.24c2.482 15.684 16.996 20.796 24.895 3.903 1.31-2.796 1.736-3.304 3.168-2.949 1.942.482 2.208 1.48 1.283 4.298-6.832 20.824-29.792 22.913-34.298-4.897l-2.739.197C.088 16.232 0 14.351 0 13.304c0-2.07.77-2.809 2.148-2.809M41.202.424a3.986 3.986 0 1 1 0 7.973 3.986 3.986 0 0 1 0-7.973"></path>
        </svg>
        <span style={{ fontWeight: 700, fontSize: '1.25rem', letterSpacing: '-0.02em' }}>
          TUI-Hotels
        </span>
      </div>

      <div className="topbar-actions">
        <button className="topbar-btn topbar-menu-btn" onClick={onMenuClick} title="Menu" aria-label="Toggle menu">
          <i className="fas fa-bars" />
        </button>
        <button
          className="topbar-btn"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <i className={`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`} />
        </button>
        <button
          className="topbar-btn"
          onClick={onLogout}
          title="Sign out"
        >
          <i className="fas fa-sign-out-alt" />
        </button>
      </div>
    </header>
  );
}
