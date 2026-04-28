/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // Phaser 3 is CommonJS; transpiling it removes the ESM/CJS interop warning.
  transpilePackages: ["phaser"],
  webpack: (config) => {
    // Polyfills for Solana/wallet-adapter packages in browser bundles.
    // crypto and stream are needed by @solana/web3.js; buffer by borsh.
    config.resolve.fallback = {
      fs: false,
      path: false,
      crypto: false,
      stream: false,
      os: false,
      net: false,
      tls: false,
      "pino-pretty": false,
      buffer: require.resolve("buffer/"),
    };

    // Phaser 3 ships as a CommonJS bundle. Webpack 5's strict ESM mode
    // flags `import Phaser from "phaser"` as "no default export" even though
    // the CJS default works at runtime. Telling webpack to treat phaser as
    // a CommonJS module silences the warning and keeps the import working.
    config.module = config.module || {};
    config.module.rules = config.module.rules || [];
    config.module.rules.push({
      test: /node_modules\/phaser\//,
      sideEffects: true,
    });

    // Inject Buffer global — required by @solana/web3.js borsh encoding
    // and by our hand-rolled instruction builders.
    const webpack = require("webpack");
    config.plugins.push(
      new webpack.ProvidePlugin({
        Buffer: ["buffer", "Buffer"],
      })
    );

    return config;
  },
};

module.exports = nextConfig;
