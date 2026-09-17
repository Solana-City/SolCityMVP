import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Tests cover the PURE logic: battle rules, season maths, wire formats and the
 * nickname rules. Those are the places where a silent change is expensive (the
 * program and the client must agree on them) and they need no browser, no
 * chain and no key-value store — the store falls back to memory outside
 * production.
 *
 * Scenes, React screens and anything touching an RPC are deliberately not
 * here: they need a DOM and a network to say anything, and those are tested in
 * the browser.
 *
 * `.mts` because vite-tsconfig-paths is ESM-only and a `.ts` config gets
 * loaded through require.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
