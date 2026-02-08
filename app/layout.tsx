// app/layout.tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Amello Availability',
  description: 'Hotel availability scanner',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
      <body style={{ margin: 0, padding: 0, backgroundColor: '#E5E0DA', fontFamily: 'Helvetica, Arial, sans-serif' }}>
        <div style={{ margin: 0, padding: 0, width: '100%', height: '100%' }}>{children}</div>
      </body>
    </html>
  );
}
