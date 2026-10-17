import type { StackFrame } from "@mini-sentry/shared";

// V8 (Chrome, Edge, Node):  "    at fn (file:line:col)"  or  "    at file:line:col"
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
// SpiderMonkey / JavaScriptCore (Firefox, Safari):  "fn@file:line:col"  or  "@file:line:col"
const GECKO_FRAME = /^\s*(?:(.*?)@)?(.+?):(\d+):(\d+)\s*$/;
// Innermost "(file:line:col)" inside a V8 "eval at ..." location.
const V8_EVAL_CALLER = /\(([^()]+):(\d+):(\d+)\)/;

export const MAX_FRAMES = 200;

/** Parses `error.stack` into frames, innermost first. Lines that are not frames are skipped. */
export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];

  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    const match = V8_FRAME.exec(line) ?? (line.includes("@") ? GECKO_FRAME.exec(line) : null);
    if (!match) continue;

    const fn = match[1];
    let [, , filename, lineno, colno] = match;
    // V8 eval frame: "at eval (eval at run (app.js:5:3), <anonymous>:1:1)". The useful location
    // is where eval was called, not the line inside the anonymous eval source.
    if (filename?.startsWith("eval at ")) {
      const caller = V8_EVAL_CALLER.exec(filename);
      if (!caller) continue;
      [, filename, lineno, colno] = caller;
    }
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
