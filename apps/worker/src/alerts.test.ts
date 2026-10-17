import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createPrismaClient, type PrismaClient } from "@mini-sentry/db";
import { UnrecoverableError } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deliverAlert, type AlertDeps } from "./alerts.js";

try {
  process.loadEnvFile("../../.env");
} catch {
  // Use the environment as is.
}
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("deliverAlert", () => {
  let prisma: PrismaClient;
  let server: Server;
  let hookBase: string;
  let userId: string;
  const received: { url?: string; body: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl!);
    userId = (
      await prisma.user.create({
        data: { email: `alert-test-${randomUUID()}@example.com`, passwordHash: "x" },
      })
    ).id;
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/gone") return res.writeHead(404).end();
        received.push({ url: req.url, body: JSON.parse(body) });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    hookBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
    await new Promise<void>((r) => server.close(() => r()));
  });

  async function seed(webhook: string | null) {
    const project = await prisma.project.create({
      data: { name: "Shop", apiKey: randomUUID(), ownerId: userId, alertWebhookUrl: webhook },
    });
    const issue = await prisma.issue.create({
      data: {
        projectId: project.id,
        fingerprint: "f",
        type: "TypeError",
        message: "x is undefined",
        culprit: "pay in /cart.js",
        count: 1,
      },
    });
    const eventId = randomUUID();
    await prisma.event.create({
      data: {
        eventId,
        projectId: project.id,
        issueId: issue.id,
        platform: "browser",
        type: "TypeError",
        message: "x is undefined",
        frames: [],
        release: "shop@2.0.0",
        timestamp: new Date(),
      },
    });
    return { projectId: project.id, issueId: issue.id, eventId };
  }

  const deps = (allowAnyHost = true): AlertDeps => ({
    prisma: prisma!,
    dashboardUrl: "https://dash.example.com",
    policy: { allowAnyHost },
  });

  it("posts the issue, release and dashboard link to the webhook", async () => {
    const ids = await seed(`${hookBase}/hook`);
    expect(await deliverAlert(deps(), { kind: "regression", ...ids })).toBe("sent");
    expect(received.at(-1)!.body).toMatchObject({
      event: "regression",
      projectName: "Shop",
      release: "shop@2.0.0",
      url: `https://dash.example.com/projects/${ids.projectId}/issues/${ids.issueId}`,
    });
  });

  it("skips projects without a webhook", async () => {
    const ids = await seed(null);
    expect(await deliverAlert(deps(), { kind: "new_issue", ...ids })).toBe("no_webhook");
  });

  it("stops retrying when the webhook is gone or not allowed", async () => {
    const gone = await seed(`${hookBase}/gone`);
    await expect(deliverAlert(deps(), { kind: "new_issue", ...gone })).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    const internal = await seed(`${hookBase}/hook`);
    await expect(
      deliverAlert(deps(false), { kind: "new_issue", ...internal }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
