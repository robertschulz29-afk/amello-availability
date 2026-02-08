// app/layout.tsx
'use client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

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
      <body style={{ margin: 0, padding: 0, backgroundColor: '#ffffff', fontFamily: 'Helvetica, Arial, sans-serif' }}>
        <div style={{ display: 'flex', minHeight: '100vh' }}>
          {/* Left-hand side navigation */}
          <nav style={{
            width: '10rem',
            backgroundColor: '#eeeeee',
            padding: '0px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            flexShrink: 0
          }}>
       
            <Link 
              href="/" 
              style={{ 
                padding: '12px 16px', 
                textDecoration: 'none',
                color: pathname === '/' ? '#000' : '#555',
                backgroundColor: pathname === '/' ? '#fffffe' : 'transparent',
                borderRadius: '4px',
                fontWeight: pathname === '/' ? '600' : '400'
              }}
            >
              Dashboard
            </Link>
            <Link 
              href="/scan-results" 
              style={{ 
                padding: '12px 16px', 
                textDecoration: 'none',
                color: pathname === '/scan-results' ? '#000' : '#555',
                backgroundColor: pathname === '/scan-results' ? '#b8b8b8' : 'transparent',
                borderRadius: '4px',
                fontWeight: pathname === '/scan-results' ? '600' : '400'
              }}
            >
              Scan Results
            </Link>
            <Link 
              href="/hotels" 
              style={{ 
                padding: '12px 16px', 
                textDecoration: 'none',
                color: pathname === '/hotels' ? '#000' : '#555',
                backgroundColor: pathname === '/hotels' ? '#b8b8b8' : 'transparent',
                borderRadius: '4px',
                fontWeight: pathname === '/hotels' ? '600' : '400'
              }}
            >
              Hotels
            </Link>
          </nav>

          {/* Main content area */}
          <div style={{ witdh:80%, flex: 1, padding: '20px', backgroundColor: '#ffffff' }}>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
