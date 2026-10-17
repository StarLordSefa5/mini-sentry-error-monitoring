// Tiny static server for the browser example. Serves examples/browser at / and the built SDK at
// /sdk/. Nothing else in the repo is reachable.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const here = import.meta.dirname;
const roots = {
  "/sdk/": resolve(here, "../packages/sdk/dist"),
  "/": resolve(here, "browser"),
};
const types = { ".html": "text/html", ".js": "text/javascript", ".map": "application/json" };
const port = Number(process.env.PORT ?? 5500);

createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const [prefix, root] = Object.entries(roots).find(([p]) => pathname.startsWith(p));
  const file = normalize(join(root, pathname.slice(prefix.length) || "index.html"));
  if (!file.startsWith(root) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Browser example on http://localhost:${port}/?dsn=<your DSN>`));
