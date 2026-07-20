const withPWA = require("@ducanh2912/next-pwa").default;

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

// ─── PWA / Service Worker ─────────────────────────────────────────────────────
//
// next-pwa generates sw.js + workbox chunks into /public at build time.
// Disabled in development to avoid stale-cache confusion during iteration.
//
// Caching strategy:
//   • Game assets (/assets/**) → CacheFirst  — tilesets/sprites never change mid-session
//   • Solana RPC / Jupiter / MagicBlock → NetworkOnly  — NEVER cache blockchain calls
//   • Everything else → next-pwa defaults (stale-while-revalidate for JS/CSS chunks)
//
// POST requests are never cached by Workbox by default, so all JSON-RPC calls
// (which are POST) are safe even without explicit NetworkOnly rules.

module.exports = withPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  reloadOnOnline: true,
  cacheOnFrontEndNav: true,

  workboxOptions: {
    // skipWaiting/clientsClaim MUST stay off: with them on, a freshly
    // deployed SW takes over tabs still running the previous build and
    // cleanupOutdatedCaches purges their precache — the old page then
    // lazy-loads a hashed chunk that exists neither in cache nor on the
    // server ("Loading chunk X failed"). The new SW now waits until all
    // tabs close; updates apply on the next visit.
    skipWaiting: false,
    clientsClaim: false,
    cleanupOutdatedCaches: true,
    // Explicit NetworkOnly for any GET calls to blockchain infra
    runtimeCaching: [
      // Solana RPC endpoints — never cache
      {
        urlPattern: /^https:\/\/api\.(mainnet-beta|devnet)\.solana\.com/,
        handler: "NetworkOnly",
      },
      // Jupiter Aggregator API — never cache
      {
        urlPattern: /^https:\/\/quote-api\.jup\.ag/,
        handler: "NetworkOnly",
      },
      // MagicBlock ephemeral rollup — never cache
      {
        urlPattern: /magicblock/,
        handler: "NetworkOnly",
      },
      // Maps + tilesets are COUPLED to the code build: a stale map JSON (or
      // a stale tileset PNG) against fresh code crashes tilemap parsing at
      // boot ("Cannot read properties of undefined" in ParseTilesets).
      // NetworkFirst keeps them always fresh online — Vercel answers cheap
      // 304s — while the cache remains as an offline fallback. CacheFirst
      // here required a manual cache-name bump on every map/tileset deploy,
      // and every forgotten bump shipped a boot crash.
      {
        urlPattern: /\/assets\/(tilesets|maps)\//,
        handler: "NetworkFirst",
        options: {
          cacheName: "sc-map-data-v1",
          networkTimeoutSeconds: 5,
          expiration: {
            maxEntries: 60,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
          },
        },
      },
      // Remaining game art (sprites, minigames, ui) — cache aggressively;
      // a stale sprite is a visual nit, never a crash.
      // v6: flush entries poisoned while maps/tilesets still lived here.
      {
        urlPattern: /\/assets\/(sprites|minigames|icons|ui)\//,
        handler: "CacheFirst",
        options: {
          cacheName: "sc-game-assets-v6",
          expiration: {
            maxEntries: 200,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
          },
        },
      },
      // Icons / manifest
      {
        urlPattern: /\/(icons|manifest\.json)/,
        handler: "CacheFirst",
        options: {
          cacheName: "sc-shell",
          expiration: {
            maxEntries: 20,
            maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
          },
        },
      },
    ],
  },
})(nextConfig);
