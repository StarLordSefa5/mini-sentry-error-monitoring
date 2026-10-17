import type { PrismaClient } from "@mini-sentry/db";
import type { StackFrame } from "@mini-sentry/shared";
import {
  SourceMapConsumer,
  type BasicSourceMapConsumer,
  type IndexedSourceMapConsumer,
} from "source-map";

type Consumer = BasicSourceMapConsumer | IndexedSourceMapConsumer;

const CONTEXT_LINES = 5;
const MAX_LINE_LENGTH = 300;
// A missing map is remembered briefly, so events from a release without maps do not query the
// database for every frame, yet a map uploaded a bit late is still picked up.
const MISSING_TTL_MS = 60_000;

/**
 * Parsed source maps, least recently used first. Parsing a large map takes milliseconds and
 * the WebAssembly-backed consumer must be destroyed explicitly, so a bounded cache pays off.
 */
export class SourceMapCache {
  private readonly entries = new Map<string, { consumer: Consumer | null; expiresAt: number }>();
  // Loads in progress, so concurrent frames for the same file parse the map once.
  private readonly loading = new Map<string, Promise<Consumer | null>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly maxEntries = 50,
  ) {}

  async get(projectId: string, release: string, filePath: string): Promise<Consumer | null> {
    const key = `${projectId}\u0000${release}\u0000${filePath}`;
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      // Re-insert to mark as recently used.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.consumer;
    }
    if (hit) this.evict(key);

    const pending = this.loading.get(key);
    if (pending) return pending;
    const load = this.load(key, projectId, release, filePath).finally(() =>
      this.loading.delete(key),
    );
    this.loading.set(key, load);
    return load;
  }

  close(): void {
    for (const key of [...this.entries.keys()]) this.evict(key);
  }

  private async load(
    key: string,
    projectId: string,
    release: string,
    filePath: string,
  ): Promise<Consumer | null> {
    const row = await this.prisma.sourceMap.findUnique({
      where: { projectId_release_filePath: { projectId, release, filePath } },
      select: { content: true },
    });
    let consumer: Consumer | null = null;
    if (row) {
      try {
        consumer = await new SourceMapConsumer(row.content);
      } catch {
        // A broken map behaves like no map: the minified frame is kept.
      }
    }

    this.entries.set(key, {
      consumer,
      expiresAt: consumer ? Number.POSITIVE_INFINITY : Date.now() + MISSING_TTL_MS,
    });
    while (this.entries.size > this.maxEntries) {
      this.evict(this.entries.keys().next().value!);
    }
    return consumer;
  }

  private evict(key: string): void {
    this.entries.get(key)?.consumer?.destroy();
    this.entries.delete(key);
  }
}

/** URL path of a frame's file: "https://cdn.example.com/assets/app.js?v=2" -> "/assets/app.js". */
export function filePathOf(filename: string): string | null {
  try {
    const url = new URL(filename);
    return url.protocol === "http:" || url.protocol === "https:" ? url.pathname : null;
  } catch {
    return filename.startsWith("/") ? filename.split(/[?#]/)[0]! : null;
  }
}

/** "webpack://shop/./src/cart.ts" or "../../src/cart.ts" -> "src/cart.ts". */
export function cleanSourcePath(source: string): string {
  return source
    .replace(/^webpack:\/\/[^/]*\//, "")
    .replace(/^(\.{1,2}\/)+/, "")
    .replace(/^\/+/, "");
}

const FUNCTION_PATTERNS = [
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/,
  /^\s*(?:(?:static|async|public|private|protected)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/,
];
const NOT_FUNCTIONS = new Set(["if", "for", "while", "switch", "catch", "return", "with"]);

/**
 * Name of the function enclosing a line, found by scanning the original source upwards.
 * A source map's own `name` field names the token at the error position (often a property such
 * as `total`), not the function, so it cannot be used for this. Heuristic, but right for the
 * usual function, arrow and method declarations.
 */
export function enclosingFunction(
  lines: string[],
  index: number,
  maxLines = 60,
): string | undefined {
  for (let i = index; i >= Math.max(0, index - maxLines); i--) {
    for (const pattern of FUNCTION_PATTERNS) {
      const name = pattern.exec(lines[i] ?? "")?.[1];
      if (name && !NOT_FUNCTIONS.has(name)) return name;
    }
  }
  return undefined;
}

function clip(line: string): string {
  return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line;
}

function sourceDetails(
  consumer: Consumer,
  source: string,
  line: number,
): { functionName?: string; context?: StackFrame["context"] } {
  const content = consumer.sourceContentFor(source, true);
  if (!content) return {};
  const lines = content.split(/\r?\n/);
  const index = line - 1;
  if (index < 0 || index >= lines.length) return {};
  return {
    functionName: enclosingFunction(lines, index),
    context: {
      pre: lines.slice(Math.max(0, index - CONTEXT_LINES), index).map(clip),
      line: clip(lines[index]!),
      post: lines.slice(index + 1, index + 1 + CONTEXT_LINES).map(clip),
    },
  };
}

/**
 * Rewrites minified browser frames to their original file, line, column and function name using
 * the source maps uploaded for this release. Frames without a matching map are returned as is.
 */
export async function symbolicate(
  cache: SourceMapCache,
  projectId: string,
  release: string | undefined,
  frames: StackFrame[],
): Promise<StackFrame[]> {
  if (!release) return frames;

  return Promise.all(
    frames.map(async (frame) => {
      if (!frame.lineno || !frame.colno) return frame;
      const filePath = filePathOf(frame.filename);
      if (!filePath) return frame;

      const consumer = await cache.get(projectId, release, filePath);
      if (!consumer) return frame;

      // Stack traces count columns from 1, source maps from 0.
      const original = consumer.originalPositionFor({
        line: frame.lineno,
        column: frame.colno - 1,
      });
      if (!original.source || original.line == null) return frame;

      const { functionName, context } = sourceDetails(consumer, original.source, original.line);
      return {
        filename: cleanSourcePath(original.source),
        function: functionName ?? frame.function,
        lineno: original.line,
        colno: original.column == null ? undefined : original.column + 1,
        ...(context ? { context } : {}),
        minified: { filename: frame.filename, lineno: frame.lineno, colno: frame.colno },
      };
    }),
  );
}
