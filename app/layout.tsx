export const metadata = { title: 'Hotel Availability Matrix' };


export default function RootLayout({ children }: { children: React.ReactNode }) {
return (
<html lang="en">
<body style={{ fontFamily: 'system-ui, sans-serif', color: '#111' }}>{children}</body>
</html>
);
}
