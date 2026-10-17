// Builds a minified bundle with hashed file names and source maps, like a production build.
// Usage: node examples/minified/build.mjs
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { build } from "esbuild";

const here = import.meta.dirname;
const out = join(here, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const result = await build({
  entryPoints: [join(here, "src/main.js")],
  bundle: true,
  minify: true,
  sourcemap: true,
  format: "esm",
  outdir: join(out, "assets"),
  entryNames: "[name]-[hash]",
  metafile: true,
  // Use the local SDK build instead of the npm package.
  alias: { "@mini-sentry/sdk": join(here, "../../packages/sdk/dist/index.js") },
  logLevel: "info",
});

const script = Object.keys(result.metafile.outputs).find((f) => f.endsWith(".js"));
writeFileSync(
  join(out, "index.html"),
  `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Mini Sentry minified example</title></head>
  <body style="font: 16px system-ui; margin: 2rem">
    <h1>Minified example</h1>
    <p>Open with <code>?dsn=&lt;DSN&gt;</code>, then click the button.</p>
    <button id="checkout">Show cart total</button>
    <p id="total"></p>
    <script type="module" src="/minified/assets/${basename(script)}"></script>
  </body>
</html>
`,
);
