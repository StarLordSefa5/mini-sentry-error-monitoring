import { describe, expect, it } from "vitest";
import { MAX_FRAMES, parseStack } from "./stack.js";

describe("parseStack", () => {
  it("parses V8 stacks (Chrome, Edge, Node)", () => {
    const stack = [
      "TypeError: x is undefined",
      "    at handleClick (http://localhost:5500/app.js:12:9)",
      "    at async load (http://localhost:5500/app.js:30:3)",
      "    at http://localhost:5500/app.js:40:1",
      "    at new Foo (file:///C:/a/b.mjs:3:5)",
      "    at Array.map (<anonymous>)",
    ].join("\n");
    expect(parseStack(stack)).toEqual([
      { filename: "http://localhost:5500/app.js", function: "handleClick", lineno: 12, colno: 9 },
      { filename: "http://localhost:5500/app.js", function: "load", lineno: 30, colno: 3 },
      { filename: "http://localhost:5500/app.js", lineno: 40, colno: 1 },
      { filename: "file:///C:/a/b.mjs", function: "new Foo", lineno: 3, colno: 5 },
    ]);
  });

  it("parses Firefox and Safari stacks", () => {
    const stack =
      "handleClick@http://localhost:5500/app.js:12:9\n@http://localhost:5500/app.js:40:1\n";
    expect(parseStack(stack)).toEqual([
      { filename: "http://localhost:5500/app.js", function: "handleClick", lineno: 12, colno: 9 },
      { filename: "http://localhost:5500/app.js", lineno: 40, colno: 1 },
    ]);
  });

  it("reports the call site for eval frames", () => {
    const stack = [
      "    at eval (eval at run (http://x/app.js:5:3), <anonymous>:1:1)",
      "    at eval (eval at a (eval at b (http://x/b.js:9:8)), <anonymous>:3:4)",
    ].join("\n");
    expect(parseStack(stack)).toEqual([
      { filename: "http://x/app.js", function: "eval", lineno: 5, colno: 3 },
      { filename: "http://x/b.js", function: "eval", lineno: 9, colno: 8 },
    ]);
  });

  it("keeps Windows paths containing parentheses", () => {
    expect(parseStack("    at Object.<anonymous> (C:\\dir (copy)\\x.js:2:3)")).toEqual([
      { filename: "C:\\dir (copy)\\x.js", function: "Object.<anonymous>", lineno: 2, colno: 3 },
    ]);
  });

  it("returns no frames for a missing stack", () => {
    expect(parseStack(undefined)).toEqual([]);
    expect(parseStack("Error: no frames here")).toEqual([]);
  });

  it(`stops at ${MAX_FRAMES} frames`, () => {
    const stack = Array.from(
      { length: MAX_FRAMES + 50 },
      (_, i) => `    at f${i} (/a.js:${i + 1}:1)`,
    );
    expect(parseStack(stack.join("\n"))).toHaveLength(MAX_FRAMES);
  });
});
