import type { StackFrame } from "@mini-sentry/shared";

// V8 (Chrome, Edge, Node):  "    at fn (file:line:col)"  or  "    at file:line:col"
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
// SpiderMonkey / JavaScriptCore (Firefox, Safari):  "fn@file:line:col"  or  "@file:line:col"
const GECKO_FRAME = /^\s*(?:(.*?)@)?(.+?):(\d+):(\d+)\s*$/;

export const MAX_FRAMES = 200;

/** Parses `error.stack` into frames, innermost first. Lines that are not frames are skipped. */
export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];

  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    const match = V8_FRAME.exec(line) ?? (line.includes("@") ? GECKO_FRAME.exec(line) : null);
    if (!match) continue;

    const [, fn, filename, lineno, colno] = match;
    if (!filename) continue;
    const name = fn?.replace(/^async /, "").trim();
    frames.push({
      filename,
      ...(name ? { function: name } : {}),
      lineno: Number(lineno),
      colno: Number(colno),
    });
    if (frames.length === MAX_FRAMES) break;
  }
  return frames;
}
