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
      </head>
      <body>
        <div className="container py-4">{children}</div>
      </body>
    </html>
  );
}
