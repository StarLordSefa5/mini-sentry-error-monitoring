import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/browser.ts", node: "src/node.ts" },
  format: ["esm", "cjs"],
  // Inline the shared wire types so the published package has no private dependency.
  dts: { resolve: ["@mini-sentry/shared"] },
  target: "es2020",
  sourcemap: true,
  clean: true,
});
