'use client';

import { ReactNode, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Header } from './components/Header';

const NAV = [
  {
    section: 'Reports',
    links: [
      { href: '/',                 icon: 'fa-gauge-high',             label: 'Dashboard' },
      { href: '/portfolio-health', icon: 'fa-heart-pulse',            label: 'Portfolio Health' },
      { href: '/price-comparison', icon: 'fa-chart-bar',              label: 'Price Comparison' },
      { href: '/rate-comparison',  icon: 'fa-arrow-right-arrow-left', label: 'Best Available Rate' },
      { href: '/scan-results',     icon: 'fa-table-list',             label: 'Scan Results' },
    ],
  },
  {
    section: 'Setup',
    links: [
      { href: '/status-overview', icon: 'fa-radar',    label: 'Scan Setup' },
      { href: '/room-mappings',   icon: 'fa-bed',      label: 'Room Mappings' },
      { href: '/hotels',          icon: 'fa-building', label: 'Hotels' },
    ],
  },
];

export default function LayoutContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);

  // Close sidebar on route change (mobile nav)
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 300);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  if (pathname === '/login') return <>{children}</>;

  return (
    <>
      <Header onLogout={handleLogout} onMenuClick={() => setSidebarOpen(o => !o)} />

      {/* Backdrop — mobile only */}
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`sidebar${sidebarOpen ? ' sidebar--open' : ''}`}>
        {NAV.map(group => (
          <div key={group.section}>
            <div className="sidebar-section-label">{group.section}</div>
            {group.links.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={`sidebar-link${pathname === link.href ? ' active' : ''}`}
              >
                <i className={`fas ${link.icon}`} />
                {link.label}
              </Link>
            ))}
          </div>
        ))}
      </aside>

      <main className="main-content">
        {children}
      </main>

      {showBackToTop && (
        <button
          className="back-to-top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
        >
          <i className="fas fa-chevron-up" />
        </button>
      )}
    </>
  );
}
