// app/LayoutContent.tsx
'use client';  

import { ReactNode, useState } from 'react';
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
  contentWrapperStyle
} from './styles/layoutStyles';
import { getToggleButtonStyle } from './styles/headerStyles';

export default function LayoutContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  
  // CHANGE: Set initial state to false so it is closed by default
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  const toggleStyle = {
    ...getToggleButtonStyle(isDark),
    backgroundColor: isHovered ? (isDark ? '#30363d' : '#e9ecef') : 'transparent'
  };

  return (
    <div style={getBodyStyle(isDark)}>
      <Header onMenuClick={toggleSidebar} />
      
      <div style={contentWrapperStyle}>
        <div style={layoutContainerStyle}>
          
          {/* Sidebar - only renders if isSidebarOpen is true */}
          {isSidebarOpen && (
            <nav style={getNavStyle(isDark)}>
              <Link href="/" style={getDashboardLinkStyle(pathname === '/', isDark)}>
                Availability Overview
              </Link>
              <Link href="/status-overview" style={getNavLinkStyle(pathname === '/status-overview', isDark)}>
                Scan Setup
              </Link>
              <Link href="/scan-results" style={getNavLinkStyle(pathname === '/scan-results', isDark)}>
                Scan Results
              </Link>
              <Link href="/price-comparison" style={getNavLinkStyle(pathname === '/price-comparison', isDark)}>
                Price Comparison
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
            </nav>
          )}

          {/* Main Content Area */}
          <div style={{ 
            ...getMainContentStyle(isDark), 
            // Optional: Ensure content takes full width when nav is gone
            width: isSidebarOpen ? 'calc(100% - 250px)' : '100%',
            transition: 'width 0.3s ease' 
          }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
