/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // Phaser uses eval() internally for some features.
  // Strict CSP will need to be configured separately for production.
  webpack: (config) => {
    config.resolve.fallback = { fs: false, path: false };
    return config;
  },
};

module.exports = nextConfig;
