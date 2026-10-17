import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findSourceMaps, parseDsn, uploadSourceMaps } from "./upload.js";

describe("parseDsn", () => {
  it("splits API base and project id", () => {
    expect(parseDsn("https://key@errors.example.com/proj1")).toEqual({
      apiUrl: "https://errors.example.com",
      projectId: "proj1",
    });
    expect(parseDsn("http://key@localhost:4000/base/proj1")).toEqual({
      apiUrl: "http://localhost:4000/base",
      projectId: "proj1",
    });
  });
});

describe("findSourceMaps and uploadSourceMaps", () => {
  let dir: string;
  let server: Server;
  let apiUrl: string;
  const requests: { url: string; auth?: string; body: string }[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "mini-sentry-cli-"));
    await mkdir(join(dir, "assets", "chunks"), { recursive: true });
    await writeFile(join(dir, "assets", "index-AAAA1111.js.map"), '{"version":3}');
    await writeFile(join(dir, "assets", "chunks", "cart-BBBB2222.mjs.map"), '{"version":3}');
    await writeFile(join(dir, "assets", "index-AAAA1111.js"), "minified");
    await writeFile(join(dir, "assets", "style.css.map"), "{}");

    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        requests.push({ url: req.url!, auth: req.headers.authorization, body });
        res.writeHead(req.url!.includes("cart") ? 500 : 201).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("finds JavaScript maps and derives the URL of each minified file", async () => {
    const files = await findSourceMaps(dir, "/static");
    expect(files.map((f) => f.urlPath)).toEqual([
      "/static/assets/chunks/cart-BBBB2222.mjs",
      "/static/assets/index-AAAA1111.js",
    ]);
  });

  it("uploads each map with the token and reports failures without stopping", async () => {
    const files = await findSourceMaps(dir);
    const summary = await uploadSourceMaps({
      apiUrl: `${apiUrl}/`,
      projectId: "proj1",
      token: "mss_secret",
      release: "shop@1.0.0",
      files,
      deleteAfter: true,
    });

    expect(summary.uploaded).toBe(1);
    expect(summary.failed.map((f) => f.file.urlPath)).toEqual(["/assets/chunks/cart-BBBB2222.mjs"]);
    expect(requests.find((r) => r.url.includes("index"))).toMatchObject({
      url: "/api/proj1/releases/shop%401.0.0/sourcemaps?file=%2Fassets%2Findex-AAAA1111.js",
      auth: "Bearer mss_secret",
      body: '{"version":3}',
    });
    // Only the uploaded map is deleted; the failed one stays for a retry.
    const left = await readdir(join(dir, "assets"), { recursive: true });
    expect(left).not.toContain("index-AAAA1111.js.map");
    expect(left.map((p) => p.replace(/\\/g, "/"))).toContain("chunks/cart-BBBB2222.mjs.map");
  });
});
