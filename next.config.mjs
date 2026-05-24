/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  serverExternalPackages: ['playwright-core', '@sparticuz/chromium-min'],
};

export default nextConfig;
