import type { StackFrame } from "@mini-sentry/shared";
import { describe, expect, it } from "vitest";
import {
  fingerprint,
  normalizeFilename,
  normalizeFunction,
  normalizeMessage,
} from "./fingerprint.js";

const frames: StackFrame[] = [
  {
    filename: "https://app.example.com/assets/app.js",
    function: "handleClick",
    lineno: 12,
    colno: 9,
  },
  { filename: "https://app.example.com/assets/app.js", function: "dispatch", lineno: 40, colno: 3 },
];
const base = {
  type: "TypeError",
  message: "Cannot read properties of undefined (reading 'name')",
  frames,
};

describe("fingerprint", () => {
  it("is stable for the same error", () => {
    expect(fingerprint(base)).toBe(fingerprint(structuredClone(base)));
    expect(fingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores line and column numbers", () => {
    const moved = {
      ...base,
      frames: frames.map((f) => ({ ...f, lineno: f.lineno! + 7, colno: 1 })),
    };
    expect(fingerprint(moved)).toBe(fingerprint(base));
  });

  it("ignores ids and numbers in the message", () => {
    const a = {
      ...base,
      type: "Error",
      message: "Order 1042 not found for user 9f1c2e4a-1b2c-4d3e-8f90-123456789abc",
    };
    const b = {
      ...base,
      type: "Error",
      message: "Order 77 not found for user 0a0b0c0d-1111-4222-8333-444455556666",
    };
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("ignores host, query string and bundle hash in file names", () => {
    const deployed = {
      ...base,
      frames: frames.map((f) => ({
        ...f,
        filename: "https://cdn.example.net/assets/app-BxK3a9Qz.js?v=3",
      })),
    };
    expect(fingerprint(deployed)).toBe(fingerprint(base));
  });

  it("separates different error types", () => {
    expect(fingerprint({ ...base, type: "RangeError" })).not.toBe(fingerprint(base));
  });

  it("separates different messages", () => {
    const other = { ...base, message: "Cannot read properties of undefined (reading 'id')" };
    expect(fingerprint(other)).not.toBe(fingerprint(base));
  });

  it("separates the same error thrown from a different function", () => {
    const other = { ...base, frames: [{ ...frames[0]!, function: "handleSubmit" }, frames[1]!] };
    expect(fingerprint(other)).not.toBe(fingerprint(base));
  });

  it("only looks at the top five frames", () => {
    const deep = Array.from({ length: 8 }, (_, i) => ({
      filename: "/src/a.js",
      function: `f${i}`,
    }));
    const differentBottom = [...deep.slice(0, 5), { filename: "/src/b.js", function: "main" }];
    expect(fingerprint({ ...base, frames: differentBottom })).toBe(
      fingerprint({ ...base, frames: deep }),
    );
  });

  it("skips node internals and node_modules when app frames exist", () => {
    const app = { filename: "/srv/app/src/db.js", function: "connect" };
    const withLib = [
      { filename: "/srv/app/node_modules/pg/lib/client.js", function: "Client.connect" },
      app,
    ];
    const withInternal = [
      { filename: "node:internal/process/task_queues", function: "process" },
      app,
    ];
    expect(fingerprint({ ...base, frames: withLib })).toBe(fingerprint({ ...base, frames: [app] }));
    expect(fingerprint({ ...base, frames: withInternal })).toBe(
      fingerprint({ ...base, frames: [app] }),
    );
  });

  it("groups errors without a stack by type and message", () => {
    expect(fingerprint({ ...base, frames: [] })).toBe(fingerprint({ ...base, frames: [] }));
    expect(fingerprint({ ...base, frames: [] })).not.toBe(fingerprint(base));
  });
});

describe("normalizeMessage", () => {
  it.each([
    ["Timeout after 3000ms", "Timeout after <num>ms"],
    ["Failed to fetch https://api.example.com/users/42?x=1", "Failed to fetch <url>"],
    ["No account for jane.doe@example.com", "No account for <email>"],
    ["Bad pointer 0x7ffde4a3", "Bad pointer <hex>"],
    ["Object 5f2b8c9d1e3a4b6c missing", "Object <hex> missing"],
    ["  spaced \n out  ", "spaced out"],
  ])("%s", (input, expected) => {
    expect(normalizeMessage(input)).toBe(expected);
  });
});

describe("normalizeFilename", () => {
  it.each([
    ["https://cdn.x.com/assets/app.3f9a2c1b.js?v=2", "/assets/app.js"],
    ["http://localhost:5173/assets/index-BxK3a9Qz.js", "/assets/index.js"],
    ["http://localhost:5173/src/my-component-BxK3a9Qz.js", "/src/my-component.js"],
    ["/src/index-settings.js", "/src/index-settings.js"],
    ["file:///C:/app/src/main.js", "/C:/app/src/main.js"],
    ["C:\\app\\src\\main.js", "C:/app/src/main.js"],
    ["node:internal/timers", "node:internal/timers"],
  ])("%s", (input, expected) => {
    expect(normalizeFilename(input)).toBe(expected);
  });
});

describe("normalizeFunction", () => {
  it.each([
    ["Timeout.loadConfig [as _onTimeout]", "Timeout.loadConfig"],
    ["async run", "run"],
    [undefined, "?"],
  ])("%s", (input, expected) => {
    expect(normalizeFunction(input)).toBe(expected);
  });
});
