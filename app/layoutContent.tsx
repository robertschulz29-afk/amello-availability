// app/LayoutContent.tsx
'use client';

import { ReactNode, useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from './context/ThemeContext';
import { Header } from './components/Header';
import {
  getBodyStyle,
  layoutContainerStyle,
  getNavStyle,
  getDashboardLinkStyle,
  getNavLinkStyle,
  getMainContentStyle,
  contentWrapperStyle,
} from './styles/layoutStyles';
import { getToggleButtonStyle } from './styles/headerStyles';

export default function LayoutContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 300);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  const toggleStyle = {
    ...getToggleButtonStyle(isDark),
    backgroundColor: isHovered ? (isDark ? '#30363d' : '#e9ecef') : 'transparent',
  };

  const isLoginPage = pathname === '/login';

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div style={getBodyStyle(isDark)}>
      <Header onMenuClick={toggleSidebar} />

      <div style={contentWrapperStyle}>
        <div style={layoutContainerStyle}>

          {isSidebarOpen && (
            <nav style={getNavStyle(isDark)}>
              <h4 style={{ paddingLeft: '1rem' }}>Reports</h4>
              <Link href="/" style={getDashboardLinkStyle(pathname === '/', isDark)}>
                Dashboard
              </Link>
              <Link href="/portfolio-health" style={getNavLinkStyle(pathname === '/portfolio-health', isDark)}>
                Portfolio Health
              </Link>
              <Link href="/price-comparison" style={getNavLinkStyle(pathname === '/price-comparison', isDark)}>
                Price Comparison
              </Link>
              <Link href="/rate-comparison" style={getNavLinkStyle(pathname === '/rate-comparison', isDark)}>
                Best Available Rate
              </Link>
              <Link href="/scan-results" style={getNavLinkStyle(pathname === '/scan-results', isDark)}>
                Scan Results
              </Link>
              <h4 style={{ paddingLeft: '1rem' }}>Setup</h4>
              <Link href="/status-overview" style={getNavLinkStyle(pathname === '/status-overview', isDark)}>
                Scan Setup
              </Link>
              <Link href="/room-mappings" style={getNavLinkStyle(pathname === '/room-mappings', isDark)}>
                Room Mappings
              </Link>
              <Link href="/hotels" style={getNavLinkStyle(pathname === '/hotels', isDark)}>
                Hotels
              </Link>

              <button
                style={toggleStyle}
                onClick={toggleTheme}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                aria-label="Toggle dark mode"
              >
                {isDark ? <i className="fas fa-sun"></i> : <i className="fas fa-moon"></i>}
              </button>

              <button
                style={{ ...toggleStyle, marginTop: '0.5rem' }}
                onClick={async () => {
                  await fetch('/api/auth/logout', { method: 'POST' });
                  window.location.href = '/login';
                }}
                aria-label="Sign out"
              >
                <i className="fas fa-sign-out-alt"></i>
              </button>
            </nav>
          )}

          <div style={{
            ...getMainContentStyle(isDark),
            width: isSidebarOpen ? 'calc(100% - 250px)' : '100%',
            transition: 'width 0.3s ease',
          }}>
            {children}
          </div>
        </div>
      </div>
      {showBackToTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          style={{
            position: 'fixed',
            bottom: '2rem', right: '2rem', zIndex: 9999,
            width: '2.5rem', height: '2.5rem',
            borderRadius: '50%',
            border: 'none',
            background: '#0d6efd',
            color: '#fff',
            fontSize: '1.1rem', cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <i className="fas fa-chevron-up" />
        </button>
      )}
    </div>
  );
}
