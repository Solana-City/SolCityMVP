import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Integration tests that talk to devnet. Deliberately NOT part of `npm test`:
 * the unit suite is offline, deterministic and fast, and mixing a network
 * dependency into it would make every run hostage to an RPC.
 *
 * These live outside `src/` so the unit config's `src/**\/*.test.ts` cannot
 * pick them up. Run them with `npm run test:devnet`.
 *
 * They only simulate, so they spend nothing and change nothing on chain.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["tests/devnet/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // One RPC at a time: the public devnet endpoint rate-limits a burst.
    fileParallelism: false,
  },
});
