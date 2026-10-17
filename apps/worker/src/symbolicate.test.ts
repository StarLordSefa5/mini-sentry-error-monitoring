import { randomUUID } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@mini-sentry/db";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanSourcePath,
  enclosingFunction,
  filePathOf,
  SourceMapCache,
  symbolicate,
} from "./symbolicate.js";

try {
  process.loadEnvFile("../../.env");
} catch {
  // Use the environment as is.
}
const databaseUrl = process.env.DATABASE_URL;

const ORIGINAL = `export function formatPrice(cents) {
  return (cents / 100).toFixed(2);
}

export const readTotal = (cart) => {
  const items = cart.items.length;
  return formatPrice(cart.summary.total) + " for " + items;
};
`;

describe("helpers", () => {
  it.each([
    ["https://cdn.example.com/assets/app.js?v=2", "/assets/app.js"],
    ["/assets/app.js#x", "/assets/app.js"],
    ["node:internal/timers", null],
    ["<anonymous>", null],
  ])("filePathOf(%s)", (input, expected) => {
    expect(filePathOf(input)).toBe(expected);
  });

  it.each([
    ["webpack://shop/./src/cart.ts", "src/cart.ts"],
    ["../../src/cart.ts", "src/cart.ts"],
    ["/src/cart.ts", "src/cart.ts"],
  ])("cleanSourcePath(%s)", (input, expected) => {
    expect(cleanSourcePath(input)).toBe(expected);
  });

  it("finds the enclosing function, arrow or method", () => {
    const lines = ORIGINAL.split("\n");
    expect(enclosingFunction(lines, 1)).toBe("formatPrice");
    expect(enclosingFunction(lines, 6)).toBe("readTotal");
    expect(
      enclosingFunction(["class A {", "  async load(id) {", "    if (x) {", "      boom();"], 3),
    ).toBe("load");
  });
});

describe.skipIf(!databaseUrl)("symbolicate", () => {
  let prisma: PrismaClient;
  let cache: SourceMapCache;
  let userId: string;
  let projectId: string;
  let minified: string;

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl!);
    cache = new SourceMapCache(prisma);
    userId = (
      await prisma.user.create({
        data: { email: `sm-test-${randomUUID()}@example.com`, passwordHash: "x" },
      })
    ).id;
    projectId = (
      await prisma.project.create({ data: { name: "sm", apiKey: randomUUID(), ownerId: userId } })
    ).id;

    // A real minified bundle and its source map, as a build tool would produce them.
    const result = await build({
      stdin: { contents: ORIGINAL, sourcefile: "src/cart.js", loader: "js" },
      outfile: "dist/assets/app-BxK3a9Qz.js",
      minify: true,
      sourcemap: "external",
      format: "esm",
      write: false,
    });
    minified = result.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
    const map = result.outputFiles.find((f) => f.path.endsWith(".map"))!.text;
    await prisma.sourceMap.create({
      data: {
        projectId,
        release: "shop@1.0.0",
        filePath: "/assets/app-BxK3a9Qz.js",
        content: map,
        size: map.length,
      },
    });
  });

  afterAll(async () => {
    cache.close();
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  /** Frame pointing at `.total` in the minified file, the way a browser would report it. */
  const minifiedFrame = () => ({
    filename: "https://shop.example.com/assets/app-BxK3a9Qz.js",
    function: "o",
    lineno: 1,
    colno: minified.indexOf(".total") + 1,
  });

  it("maps a minified frame to the original file, line, function and code", async () => {
    const [frame] = await symbolicate(cache, projectId, "shop@1.0.0", [minifiedFrame()]);
    expect(frame).toMatchObject({
      filename: "src/cart.js",
      function: "readTotal",
      lineno: 7,
      minified: { filename: minifiedFrame().filename, lineno: 1 },
    });
    expect(frame!.context?.line).toContain("cart.summary.total");
    expect(frame!.context?.pre.at(-1)).toContain("cart.items.length");
  });

  it("leaves frames alone without a matching release, file or position", async () => {
    const frame = minifiedFrame();
    expect(await symbolicate(cache, projectId, "shop@2.0.0", [frame])).toEqual([frame]);
    expect(await symbolicate(cache, projectId, undefined, [frame])).toEqual([frame]);
    const other = { ...frame, filename: "https://shop.example.com/assets/other.js" };
    expect(await symbolicate(cache, projectId, "shop@1.0.0", [other])).toEqual([other]);
    const noColumn = { filename: frame.filename, lineno: 1 };
    expect(await symbolicate(cache, projectId, "shop@1.0.0", [noColumn])).toEqual([noColumn]);
  });

  it("parses each map once even when many frames need it at the same time", async () => {
    const fresh = new SourceMapCache(prisma);
    const consumers = await Promise.all(
      Array.from({ length: 10 }, () =>
        fresh.get(projectId, "shop@1.0.0", "/assets/app-BxK3a9Qz.js"),
      ),
    );
    expect(new Set(consumers).size).toBe(1);
    fresh.close();
  });
});
