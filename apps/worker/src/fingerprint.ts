import { createHash } from "node:crypto";
import type { ErrorEvent, StackFrame } from "@mini-sentry/shared";

/** How many frames, innermost first, take part in the fingerprint. */
export const FINGERPRINT_FRAMES = 5;

// Order matters: specific patterns run before the generic number rule.
const MESSAGE_RULES: [RegExp, string][] = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  [/\bhttps?:\/\/[^\s'"]+/gi, "<url>"],
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "<email>"],
  [/\b0x[0-9a-f]+\b/gi, "<hex>"],
  [/\b[0-9a-f]{12,}\b/gi, "<hex>"],
  [/\d+(\.\d+)?/g, "<num>"],
];

/**
 * Replaces values that change between occurrences (ids, numbers, URLs) with placeholders.
 * Quoted text is kept: `reading 'name'` and `reading 'id'` are usually different bugs.
 */
export function normalizeMessage(message: string): string {
  let result = message;
  for (const [pattern, placeholder] of MESSAGE_RULES) {
    result = result.replace(pattern, placeholder);
  }
  return result.replace(/\s+/g, " ").trim();
}

/**
 * Reduces a frame's file to something stable across deploys and hosts: no origin, query string,
 * hash, or content hash in the bundle name. `https://cdn.x.com/assets/app.3f9a2c1b.js?v=2` and
 * `http://localhost:5173/assets/app.js` both become `/assets/app.js`.
 */
export function normalizeFilename(filename: string): string {
  let path = filename.replace(/[?#].*$/, "");
  path = path.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]*/i, "");
  path = path.replace(/\\/g, "/");
  return path.replace(/[.-](\w{6,})(?=\.[a-z]+$)/i, (segment, name: string) =>
    isContentHash(name) ? "" : segment,
  );
}

// Bundler content hashes: hex (webpack: "3f9a2c1b") or 8+ base64url chars with a digit
// (Vite: "BxK3a9Qz"). Words such as "settings" have no digit, so "index-settings.js" is kept.
function isContentHash(name: string): boolean {
  return /^[0-9a-f]{6,}$/i.test(name) || (name.length >= 8 && /\d/.test(name));
}

/** `Timeout.loadConfig [as _onTimeout]` -> `Timeout.loadConfig`; `async run` -> `run`. */
export function normalizeFunction(name: string | undefined): string {
  if (!name) return "?";
  return name
    .replace(/ \[as [^\]]+\]$/, "")
    .replace(/^async /, "")
    .trim();
}

function isAppFrame(frame: StackFrame): boolean {
  return !/^node:|\/node_modules\/|^<anonymous>$|^native$/.test(frame.filename.replace(/\\/g, "/"));
}

/**
 * Groups events: same error type, same message shape and same top in-app frames means same issue.
 * Line and column numbers are left out on purpose, so unrelated edits elsewhere in a file do not
 * split an issue in two after a deploy.
 */
export function fingerprint(event: Pick<ErrorEvent, "type" | "message" | "frames">): string {
  const appFrames = event.frames.filter(isAppFrame);
  // Library-only stacks (e.g. errors thrown inside node_modules) still group by their frames.
  const frames = (appFrames.length ? appFrames : event.frames).slice(0, FINGERPRINT_FRAMES);

  const parts = [
    event.type,
    normalizeMessage(event.message),
    ...frames.map((f) => `${normalizeFilename(f.filename)}:${normalizeFunction(f.function)}`),
  ];
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

/** Human-readable location for the issue list, e.g. `checkout in /assets/cart.js`. */
export function culprit(frames: StackFrame[]): string | null {
  const top = frames.find(isAppFrame) ?? frames[0];
  if (!top) return null;
  const file = normalizeFilename(top.filename);
  return top.function ? `${normalizeFunction(top.function)} in ${file}` : file;
}
