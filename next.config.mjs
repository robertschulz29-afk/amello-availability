/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  experimental: {
    serverComponentsExternalPackages: ['playwright-core', '@sparticuz/chromium-min'],
  },
};

export default nextConfig;
