import type { ErrorEvent } from "@mini-sentry/shared";
import { describe, expect, it } from "vitest";
import { scrubUrl } from "./breadcrumbs.js";
import { Client, type Transport, type TransportResult } from "./client.js";

const DSN = "http://key@localhost:4000/project";

function setup(options: { maxBreadcrumbs?: number; reply?: () => TransportResult | void } = {}) {
  const sent: ErrorEvent[] = [];
  const transport: Transport = async (event) => {
    sent.push(event);
    return options.reply?.();
  };
  const client = new Client(
    { dsn: DSN, maxBreadcrumbs: options.maxBreadcrumbs },
    "browser",
    transport,
  );
  return { client, sent };
}

describe("breadcrumbs", () => {
  it("keeps only the most recent ones and attaches a copy to each event", async () => {
    const { client, sent } = setup({ maxBreadcrumbs: 3 });
    for (const n of [1, 2, 3, 4, 5]) client.addBreadcrumb({ type: "custom", message: `step ${n}` });

    client.captureException(new Error("first"));
    client.addBreadcrumb({ type: "click", message: "button#retry" });
    client.captureException(new Error("second"));
    await client.flush();

    expect(sent[0]!.breadcrumbs!.map((b) => b.message)).toEqual(["step 3", "step 4", "step 5"]);
    expect(sent[1]!.breadcrumbs!.map((b) => b.message)).toEqual([
      "step 4",
      "step 5",
      "button#retry",
    ]);
    expect(sent[0]!.breadcrumbs![0]!.timestamp).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("can be turned off", async () => {
    const { client, sent } = setup({ maxBreadcrumbs: 0 });
    client.addBreadcrumb({ type: "custom", message: "ignored" });
    client.captureException(new Error("boom"));
    await client.flush();
    expect(sent[0]!.breadcrumbs).toBeUndefined();
  });

  it("truncates long messages", async () => {
    const { client, sent } = setup();
    client.addBreadcrumb({ type: "console", message: "x".repeat(5000) });
    client.captureException(new Error("boom"));
    await client.flush();
    expect(sent[0]!.breadcrumbs![0]!.message.length).toBeLessThanOrEqual(1024);
  });
});

describe("rate limiting", () => {
  it("stops sending after a 429 until Retry-After has passed", async () => {
    let limited = true;
    const { client, sent } = setup({
      reply: () => (limited ? { retryAfterSeconds: 60 } : undefined),
    });

    expect(client.captureException(new Error("one"))).toBeDefined();
    await client.flush();
    limited = false;
    // Paused: dropped on the client, never reaches the transport.
    expect(client.captureException(new Error("two"))).toBeUndefined();
    expect(sent).toHaveLength(1);
  });

  it("falls back to a default pause when Retry-After is missing", async () => {
    const { client, sent } = setup({ reply: () => ({ retryAfterSeconds: Number.NaN }) });
    client.captureException(new Error("one"));
    await client.flush();
    client.captureException(new Error("two"));
    expect(sent).toHaveLength(1);
  });
});

describe("scrubUrl", () => {
  it.each([
    ["/api/orders?token=secret#x", "https://shop.example.com/cart", "/api/orders"],
    ["https://shop.example.com/api/me?session=abc", "https://shop.example.com/", "/api/me"],
    [
      "https://api.stripe.com/v1/charges?key=sk",
      "https://shop.example.com/",
      "https://api.stripe.com/v1/charges",
    ],
  ])("%s", (url, base, expected) => {
    expect(scrubUrl(url, base)).toBe(expected);
  });
});
