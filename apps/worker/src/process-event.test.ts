import { randomUUID } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@mini-sentry/db";
import type { ErrorEvent, IngestJobData } from "@mini-sentry/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { processEvent } from "./process-event.js";

// Integration tests: they need the Postgres from docker-compose (`pnpm infra:up`).
try {
  process.loadEnvFile("../../.env");
} catch {
  // Use the environment as is.
}
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("processEvent", () => {
  let prisma: PrismaClient;
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl!);
    const user = await prisma.user.create({
      data: { email: `worker-test-${randomUUID()}@example.com`, passwordHash: "x" },
    });
    userId = user.id;
  });

  beforeEach(async () => {
    const project = await prisma.project.create({
      data: { name: "worker test", apiKey: randomUUID(), ownerId: userId },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    // Cascades to projects, issues and events.
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const job = (overrides: Partial<ErrorEvent> = {}, receivedAt = new Date()): IngestJobData => ({
    projectId,
    receivedAt: receivedAt.toISOString(),
    event: {
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      platform: "browser",
      type: "TypeError",
      message: "Cannot read properties of undefined (reading 'name')",
      frames: [{ filename: "/assets/app.js", function: "handleClick", lineno: 12, colno: 9 }],
      ...overrides,
    },
  });

  it("groups 100 occurrences of the same error into one issue with count 100", async () => {
    for (let i = 0; i < 100; i++) {
      // Line numbers and ids change between occurrences; the issue must not split.
      await processEvent(
        prisma,
        job({
          message: `Order ${i} failed`,
          frames: [{ filename: "/assets/app.js", function: "checkout", lineno: i + 1 }],
        }),
      );
    }
    const issues = await prisma.issue.findMany({ where: { projectId } });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.count).toBe(100);
    expect(await prisma.event.count({ where: { projectId, issueId: issues[0]!.id } })).toBe(100);
  });

  it("counts concurrent events for the same issue without losing increments", async () => {
    await Promise.all(Array.from({ length: 50 }, () => processEvent(prisma, job())));
    const issues = await prisma.issue.findMany({ where: { projectId } });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.count).toBe(50);
  });

  it("puts different errors into different issues", async () => {
    const a = await processEvent(prisma, job({ type: "TypeError" }));
    const b = await processEvent(prisma, job({ type: "RangeError" }));
    expect(a.status === "stored" && a.newIssue).toBe(true);
    expect(b.status === "stored" && b.newIssue).toBe(true);
    expect(await prisma.issue.count({ where: { projectId } })).toBe(2);
  });

  it("stores and counts a repeated eventId once", async () => {
    const repeated = job();
    expect((await processEvent(prisma, repeated)).status).toBe("stored");
    expect(await processEvent(prisma, repeated)).toEqual({ status: "duplicate" });
    // Concurrent repeats race past the early check; the transaction must still roll back.
    const racing = job();
    const results = await Promise.all([processEvent(prisma, racing), processEvent(prisma, racing)]);
    expect(results.map((r) => r.status).sort()).toEqual(["duplicate", "stored"]);

    const issue = await prisma.issue.findFirstOrThrow({ where: { projectId } });
    expect(issue.count).toBe(2);
    expect(await prisma.event.count({ where: { projectId } })).toBe(2);
  });

  it("uses server receive time for first/last seen, even when jobs finish out of order", async () => {
    const early = new Date("2026-10-17T10:00:00.000Z");
    const late = new Date("2026-10-17T12:00:00.000Z");
    // Client clock is way off; it must not matter.
    await processEvent(prisma, job({ timestamp: "1999-01-01T00:00:00.000Z" }, late));
    await processEvent(prisma, job({}, early));

    const issue = await prisma.issue.findFirstOrThrow({ where: { projectId } });
    expect(issue.firstSeen.toISOString()).toBe(early.toISOString());
    expect(issue.lastSeen.toISOString()).toBe(late.toISOString());
  });

  it("drops events for a project deleted after ingestion", async () => {
    const orphan = job();
    await prisma.project.delete({ where: { id: projectId } });
    expect(await processEvent(prisma, orphan)).toEqual({ status: "dropped" });
  });
});
