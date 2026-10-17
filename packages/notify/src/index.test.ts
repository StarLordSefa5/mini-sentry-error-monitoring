import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildPayload,
  checkWebhookUrl,
  sendWebhook,
  WebhookError,
  type AlertMessage,
} from "./index.js";

const strict = { allowAnyHost: false };
const loose = { allowAnyHost: true };

describe("checkWebhookUrl", () => {
  it.each([
    ["https://discord.com/api/webhooks/123/abc", "discord"],
    ["https://discordapp.com/api/webhooks/123/abc", "discord"],
    ["https://hooks.slack.com/services/T0/B0/xyz", "slack"],
  ])("accepts %s", (url, provider) => {
    expect(checkWebhookUrl(url, strict)).toEqual({ ok: true, provider });
  });

  it.each([
    "http://discord.com/api/webhooks/123/abc", // not https
    "https://discord.com/channels/1/2", // not a webhook path
    "https://discord.com.evil.example/api/webhooks/1/2", // look-alike host
    "https://user:pass@hooks.slack.com/services/T0/B0/x", // credentials
    "http://localhost:6379/", // internal service
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "file:///etc/passwd",
    "not a url",
  ])("rejects %s", (url) => {
    expect(checkWebhookUrl(url, strict).ok).toBe(false);
  });

  it("accepts any http(s) URL only when explicitly allowed", () => {
    expect(checkWebhookUrl("http://localhost:9999/hook", loose)).toEqual({
      ok: true,
      provider: "generic",
    });
    expect(checkWebhookUrl("ftp://localhost/hook", loose).ok).toBe(false);
  });
});

const msg: AlertMessage = {
  kind: "new_issue",
  projectName: "Shop",
  issue: {
    type: "TypeError",
    message: "x is <undefined> & broken",
    culprit: "pay in /cart.js",
    count: 1,
  },
  url: "https://dash.example.com/projects/p/issues/i",
  release: "shop@1.0.0",
};

describe("buildPayload", () => {
  it("builds a Discord embed", () => {
    const body = buildPayload("discord", msg) as { embeds: Record<string, unknown>[] };
    expect(body.embeds[0]).toMatchObject({
      title: "New issue: TypeError",
      url: msg.url,
      fields: expect.arrayContaining([
        { name: "Location", value: "pay in /cart.js", inline: true },
      ]),
    });
  });

  it("builds Slack blocks with escaped text", () => {
    const body = JSON.stringify(buildPayload("slack", msg));
    expect(body).toContain("x is &lt;undefined&gt; &amp; broken");
    expect(body).toContain(`<${msg.url}|New issue: TypeError>`);
  });

  it("caps Discord's description length", () => {
    const long = { ...msg, issue: { ...msg.issue, message: "a".repeat(10_000) } };
    const body = buildPayload("discord", long) as { embeds: { description: string }[] };
    expect(body.embeds[0]!.description.length).toBeLessThanOrEqual(2000);
  });
});

describe("sendWebhook", () => {
  let server: Server;
  let base: string;
  const received: unknown[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        if (req.url === "/ok") {
          received.push(JSON.parse(body));
          res.writeHead(204).end();
        } else if (req.url === "/gone") res.writeHead(404).end();
        else if (req.url === "/busy") res.writeHead(503).end();
        else res.writeHead(302, { location: "http://169.254.169.254/" }).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("posts the payload", async () => {
    await sendWebhook(`${base}/ok`, msg, loose);
    expect(received.at(-1)).toMatchObject({ event: "new_issue", projectName: "Shop" });
  });

  it("marks a deleted webhook as not retryable and a 503 as retryable", async () => {
    await expect(sendWebhook(`${base}/gone`, msg, loose)).rejects.toMatchObject({
      retryable: false,
    });
    await expect(sendWebhook(`${base}/busy`, msg, loose)).rejects.toMatchObject({
      retryable: true,
    });
  });

  it("does not follow redirects", async () => {
    await expect(sendWebhook(`${base}/redirect`, msg, loose)).rejects.toBeInstanceOf(WebhookError);
  });

  it("refuses URLs the policy does not allow", async () => {
    await expect(sendWebhook(`${base}/ok`, msg, strict)).rejects.toMatchObject({
      retryable: false,
    });
  });
});
