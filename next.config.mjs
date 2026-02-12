/** @type {import('next').NextConfig} */
const nextConfig = {
  // Webpack configuration for serverless deployments
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Mark @sparticuz/chromium as external to prevent webpack from bundling it
      // This is necessary because the package includes pre-built binaries
      config.externals = config.externals || [];
      config.externals.push('@sparticuz/chromium');
    }
    return config;
  },
  
  // Serverless function configuration
  experimental: {
    // Increase serverless function size limit if needed
    // Default is 50MB, but chromium requires more
    serverComponentsExternalPackages: ['@sparticuz/chromium'],
  },
};

export default nextConfig;
