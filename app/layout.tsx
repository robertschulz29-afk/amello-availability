// app/layout.tsx
'use client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Header } from './components/Header';
import {
  bodyStyle,
  layoutContainerStyle,
  navStyle,
  getDashboardLinkStyle,
  getNavLinkStyle,
  mainContentStyle,
  contentWrapperStyle
} from './styles/layoutStyles';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <html lang="en">
      <head>
        {/* Bootstrap 5 CSS (CDN) */}
        <link
          href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
          rel="stylesheet"
          integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH"
          crossOrigin="anonymous"
        />
        {/* Font Awesome 6 CSS (CDN) */}
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
          integrity="sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA=="
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
        />
      </head>
      <body style={bodyStyle}>
        <Header />
        <div style={contentWrapperStyle}>
          <div style={layoutContainerStyle}>
            {/* Left-hand side navigation */}
            <nav style={navStyle}>
         
              <Link 
                href="/" 
                style={getDashboardLinkStyle(pathname === '/')}
              >
                Dashboard
              </Link>
              <Link 
                href="/status-overview" 
                style={getNavLinkStyle(pathname === '/status-overview')}
              >
                Status Overview
              </Link>
              <Link 
                href="/scan-results" 
                style={getNavLinkStyle(pathname === '/scan-results')}
              >
                Scan Results
              </Link>
              <Link 
                href="/hotels" 
                style={getNavLinkStyle(pathname === '/hotels')}
              >
                Hotels
              </Link>
            </nav>

            {/* Main content area */}
            <div style={mainContentStyle}>
              {children}
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
