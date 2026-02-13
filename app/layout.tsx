// app/layout.tsx
'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { Header } from './components/Header';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import {
  getBodyStyle,
  layoutContainerStyle,
  getNavStyle,
  getDashboardLinkStyle,
  getNavLinkStyle,
  getMainContentStyle,
  contentWrapperStyle
} from './styles/layoutStyles';
import { getToggleButtonStyle } from './styles/headerStyles';

function LayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const [isHovered, setIsHovered] = useState(false);

  const toggleStyle = {
    ...getToggleButtonStyle(isDark),
    backgroundColor: isHovered
      ? isDark
        ? '#30363d'
        : '#e9ecef'
      : 'transparent'
  };

  return (
    <body style={getBodyStyle(isDark)}>
      <Header />

      <div style={contentWrapperStyle}>
        <div style={layoutContainerStyle}>
          {/* Left-hand navigation */}
          <nav style={getNavStyle(isDark)}>
            <Link
              href="/"
              style={getDashboardLinkStyle(pathname === '/', isDark)}
            >
              Availability Overview
            </Link>

            <Link
              href="/status-overview"
              style={getNavLinkStyle(pathname === '/status-overview', isDark)}
            >
              Scan Setup
            </Link>

            <Link
              href="/scan-results"
              style={getNavLinkStyle(pathname === '/scan-results', isDark)}
            >
              Scan Results
            </Link>

            <Link
              href="/price-comparison"
              style={getNavLinkStyle(pathname === '/price-comparison', isDark)}
            >
              Price Comparison
            </Link>

            <Link
              href="/hotels"
              style={getNavLinkStyle(pathname === '/hotels', isDark)}
            >
              Hotels
            </Link>

            {/* Dark Mode Toggle */}
            <button
              style={toggleStyle}
              onClick={toggleTheme}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              aria-label="Toggle dark mode"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? (
                <i className="fas fa-sun"></i>
              ) : (
                <i className="fas fa-moon"></i>
              )}
            </button>
          </nav>

          {/* Main content */}
          <div style={getMainContentStyle(isDark)}>
            {children}
          </div>
        </div>
      </div>
    </body>
  );
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
        />
      </head>
      <ThemeProvider>
        <LayoutContent>{children}</LayoutContent>
      </ThemeProvider>
    </html>
  );
}
