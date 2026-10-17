import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createPrismaClient, type PrismaClient } from "@mini-sentry/db";
import type {
  IngestJobData,
  IssueDetailResponse,
  IssueListResponse,
  IssueStatsResponse,
  ProjectDto,
} from "@mini-sentry/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { EventsQueue } from "./lib/queue.js";
import type { RateLimiter } from "./lib/rate-limit.js";

// Integration tests: they need the Postgres from docker-compose (`pnpm infra:up`). Redis is
// replaced by an in-memory fake queue.
try {
  process.loadEnvFile("../../.env");
} catch {
  // Use the environment as is.
}
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("API", () => {
  let app: FastifyInstance;
  // Same app with WEBHOOK_ALLOW_ANY_HOST, to deliver test alerts to a local server.
  let looseApp: FastifyInstance;
  let prisma: PrismaClient;
  // Counts per project; the limit is tiny so the test can hit it.
  const RATE_LIMIT = 3;
  const hits = new Map<string, number>();
  const fakeLimiter: RateLimiter = {
    hit: async (projectId) => {
      const used = (hits.get(projectId) ?? 0) + 1;
      hits.set(projectId, used);
      return {
        allowed: used <= RATE_LIMIT,
        limit: RATE_LIMIT,
        remaining: Math.max(0, RATE_LIMIT - used),
        resetSeconds: 42,
      };
    },
  };
  const queued: { data: IngestJobData; jobId?: string }[] = [];
  const emails: string[] = [];

  const fakeQueue: EventsQueue = {
    add: (async (_name: string, data: IngestJobData, opts?: { jobId?: string }) => {
      queued.push({ data, jobId: opts?.jobId });
      return {};
    }) as unknown as EventsQueue["add"],
    close: async () => {},
  };

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl!);
    const deps = { prisma, eventsQueue: fakeQueue, rateLimiter: fakeLimiter };
    const env = { ...process.env, NODE_ENV: "test" };
    app = await buildApp({
      ...deps,
      config: loadConfig({ ...env, WEBHOOK_ALLOW_ANY_HOST: "false" }),
    });
    looseApp = await buildApp({
      ...deps,
      config: loadConfig({ ...env, WEBHOOK_ALLOW_ANY_HOST: "true" }),
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
    await looseApp.close();
    await prisma.$disconnect();
  });

  /** Registers a fresh user and returns its session cookie header. */
  async function signUp(): Promise<string> {
    const email = `api-test-${randomUUID()}@example.com`;
    emails.push(email);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "correct horse battery" },
    });
    expect(res.statusCode).toBe(201);
    const session = res.cookies.find((c) => c.name === "ms_session");
    expect(session?.httpOnly).toBe(true);
    return `ms_session=${session!.value}`;
  }

  async function createProject(cookie: string): Promise<ProjectDto> {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Test project" },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ project: ProjectDto }>().project;
  }

  const event = () => ({
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    platform: "browser",
    type: "TypeError",
    message: "boom",
    frames: [],
  });

  describe("auth", () => {
    it("logs in, reports the user, and logs out", async () => {
      const cookie = await signUp();
      const me = await app.inject({ url: "/api/auth/me", headers: { cookie } });
      expect(me.statusCode).toBe(200);

      const out = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { cookie },
      });
      expect(out.statusCode).toBe(204);
      const after = await app.inject({ url: "/api/auth/me", headers: { cookie } });
      expect(after.statusCode).toBe(401);
    });

    it("gives the same answer for an unknown email and a wrong password", async () => {
      await signUp();
      const unknown = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "nobody@example.com", password: "whatever1" },
      });
      const wrong = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: emails.at(-1), password: "wrong password" },
      });
      expect(unknown.statusCode).toBe(401);
      expect(wrong.statusCode).toBe(401);
      expect(unknown.json()).toEqual(wrong.json());
    });
  });

  describe("projects", () => {
    it("hides other users' projects and never accepts the API key", async () => {
      const owner = await signUp();
      const other = await signUp();
      const project = await createProject(owner);

      const asOther = await app.inject({
        url: `/api/projects/${project.id}`,
        headers: { cookie: other },
      });
      expect(asOther.statusCode).toBe(404);

      const withKey = await app.inject({
        url: `/api/projects/${project.id}`,
        headers: { "x-mini-sentry-key": project.apiKey },
      });
      expect(withKey.statusCode).toBe(401);
    });
  });

  describe("ingestion", () => {
    it("queues a valid event and answers 202", async () => {
      const project = await createProject(await signUp());
      const payload = event();
      const res = await app.inject({
        method: "POST",
        url: `/api/${project.id}/events?key=${project.apiKey}`,
        headers: { "content-type": "text/plain" },
        payload: JSON.stringify(payload),
      });
      expect(res.statusCode).toBe(202);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
      expect(queued.at(-1)).toMatchObject({
        jobId: payload.eventId,
        data: { projectId: project.id },
      });
    });

    it("rejects a missing key, an unknown key and another project's key", async () => {
      const cookie = await signUp();
      const a = await createProject(cookie);
      const b = await createProject(cookie);
      const send = (query: string) =>
        app.inject({ method: "POST", url: `/api/${a.id}/events${query}`, payload: event() });

      expect((await send("")).statusCode).toBe(401);
      expect((await send("?key=nope")).statusCode).toBe(401);
      expect((await send(`?key=${b.apiKey}`)).statusCode).toBe(401);
    });

    it("stops accepting a rotated key", async () => {
      const cookie = await signUp();
      const project = await createProject(cookie);
      const send = () =>
        app.inject({
          method: "POST",
          url: `/api/${project.id}/events?key=${project.apiKey}`,
          payload: event(),
        });
      expect((await send()).statusCode).toBe(202);

      await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/api-key/rotate`,
        headers: { cookie },
      });
      expect((await send()).statusCode).toBe(401);
    });
  });

  describe("issues", () => {
    async function seed() {
      const cookie = await signUp();
      const project = await createProject(cookie);
      const now = Date.now();
      const make = (fingerprint: string, data: { type: string; message: string; count: number }) =>
        prisma.issue.create({
          data: {
            projectId: project.id,
            fingerprint,
            ...data,
            culprit: "checkout in /assets/cart.js",
            firstSeen: new Date(now - 3 * 3600_000),
            lastSeen: new Date(now - (data.count === 3 ? 0 : 3600_000)),
          },
        });
      const hot = await make("a", { type: "TypeError", message: "x is undefined", count: 3 });
      const cold = await make("b", { type: "RangeError", message: "bad length", count: 1 });

      // 2 events in the current hour, 1 two hours ago.
      for (const ago of [0, 60_000, 2 * 3600_000]) {
        await prisma.event.create({
          data: {
            ...event(),
            frames: [{ filename: "/assets/cart.js", function: "checkout", lineno: 1 }],
            userAgent: "Mozilla/5.0 Chrome/131.0",
            timestamp: new Date(now - ago),
            receivedAt: new Date(now - ago),
            projectId: project.id,
            issueId: hot.id,
          },
        });
      }
      return { cookie, project, hot, cold, base: `/api/projects/${project.id}/issues` };
    }

    it("lists issues with sort, search and status filter", async () => {
      const { cookie, hot, cold, base } = await seed();
      const list = async (query: string) => {
        const res = await app.inject({ url: `${base}${query}`, headers: { cookie } });
        expect(res.statusCode).toBe(200);
        return res.json<IssueListResponse>();
      };

      const all = await list("");
      expect(all.total).toBe(2);
      expect(all.issues.map((i) => i.id)).toEqual([hot.id, cold.id]);
      expect(all.issues[0]).toMatchObject({ count: 3, culprit: "checkout in /assets/cart.js" });

      expect((await list("?q=range")).issues.map((i) => i.id)).toEqual([cold.id]);
      expect((await list("?sort=count&limit=1&page=2")).issues.map((i) => i.id)).toEqual([cold.id]);

      await app.inject({
        method: "PATCH",
        url: `${base}/${hot.id}`,
        headers: { cookie },
        payload: { status: "resolved" },
      });
      expect((await list("")).issues.map((i) => i.id)).toEqual([cold.id]);
      expect((await list("?status=resolved")).issues.map((i) => i.id)).toEqual([hot.id]);
    });

    it("returns detail, recent events and hourly stats", async () => {
      const { cookie, hot, base } = await seed();

      const detail = await app.inject({ url: `${base}/${hot.id}`, headers: { cookie } });
      const body = detail.json<IssueDetailResponse>();
      expect(body.issue.id).toBe(hot.id);
      expect(body.latestEvent?.frames[0]).toMatchObject({ function: "checkout" });

      const events = await app.inject({ url: `${base}/${hot.id}/events`, headers: { cookie } });
      expect(events.json<{ events: unknown[] }>().events).toHaveLength(3);

      const stats = await app.inject({ url: `${base}/${hot.id}/stats`, headers: { cookie } });
      const { buckets } = stats.json<IssueStatsResponse>();
      expect(buckets).toHaveLength(24);
      expect(buckets.at(-1)!.count).toBeGreaterThanOrEqual(1);
      expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(3);
      expect(new Date(buckets.at(-1)!.start).getTime()).toBeLessThanOrEqual(Date.now());

      const week = await app.inject({
        url: `${base}/${hot.id}/stats?range=7d`,
        headers: { cookie },
      });
      expect(week.json<IssueStatsResponse>().buckets).toHaveLength(7);
    });

    it("rejects an invalid status and hides issues from other users", async () => {
      const { cookie, hot, base } = await seed();
      const bad = await app.inject({
        method: "PATCH",
        url: `${base}/${hot.id}`,
        headers: { cookie },
        payload: { status: "deleted" },
      });
      expect(bad.statusCode).toBe(400);

      const stranger = await signUp();
      for (const url of [base, `${base}/${hot.id}`, `${base}/${hot.id}/stats`]) {
        expect((await app.inject({ url, headers: { cookie: stranger } })).statusCode).toBe(404);
      }
    });
  });

  describe("rate limiting and breadcrumbs", () => {
    it("answers 429 with Retry-After once a project is over its limit", async () => {
      const project = await createProject(await signUp());
      const send = () =>
        app.inject({
          method: "POST",
          url: `/api/${project.id}/events?key=${project.apiKey}`,
          payload: event(),
        });
      for (let i = 0; i < RATE_LIMIT; i++) expect((await send()).statusCode).toBe(202);

      const limited = await send();
      expect(limited.statusCode).toBe(429);
      expect(limited.headers["retry-after"]).toBe("42");
      expect(limited.headers["access-control-expose-headers"]).toContain("retry-after");
    });

    it("accepts breadcrumbs and rejects malformed ones", async () => {
      const project = await createProject(await signUp());
      const send = (breadcrumbs: unknown) =>
        app.inject({
          method: "POST",
          url: `/api/${project.id}/events?key=${project.apiKey}`,
          payload: { ...event(), breadcrumbs },
        });
      const crumb = { type: "click", timestamp: new Date().toISOString(), message: "button#pay" };
      expect(
        (await send([crumb, { ...crumb, type: "fetch", data: { status: 500 } }])).statusCode,
      ).toBe(202);
      expect((await send([{ ...crumb, type: "keylogger" }])).statusCode).toBe(400);
      expect((await send([{ ...crumb, data: { nested: { a: 1 } } }])).statusCode).toBe(400);
    });
  });

  describe("alerts", () => {
    let server: Server;
    let hook: string;
    const received: Record<string, unknown>[] = [];

    beforeAll(async () => {
      server = createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          received.push(JSON.parse(body));
          res.writeHead(204).end();
        });
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      hook = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
    });

    afterAll(() => new Promise<void>((r) => server.close(() => r())));

    it("only accepts Discord or Slack webhooks by default", async () => {
      const cookie = await signUp();
      const project = await createProject(cookie);
      const patch = (alertWebhookUrl: string | null) =>
        app.inject({
          method: "PATCH",
          url: `/api/projects/${project.id}`,
          headers: { cookie },
          payload: { alertWebhookUrl },
        });

      for (const url of ["http://localhost:6379", "http://169.254.169.254/", hook]) {
        const res = await patch(url);
        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({ error: "invalid_webhook" });
      }
      const ok = await patch("https://discord.com/api/webhooks/1/abc");
      expect(ok.json<{ project: ProjectDto }>().project.alertWebhookUrl).toBe(
        "https://discord.com/api/webhooks/1/abc",
      );
      expect((await patch("")).json<{ project: ProjectDto }>().project.alertWebhookUrl).toBeNull();
    });

    it("sends a test notification", async () => {
      const cookie = await signUp();
      const project = await createProject(cookie);
      await looseApp.inject({
        method: "PATCH",
        url: `/api/projects/${project.id}`,
        headers: { cookie },
        payload: { alertWebhookUrl: hook },
      });

      const res = await looseApp.inject({
        method: "POST",
        url: `/api/projects/${project.id}/alerts/test`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(204);
      expect(received.at(-1)).toMatchObject({
        event: "test",
        projectName: "Test project",
        url: expect.stringMatching(new RegExp(`/projects/${project.id}/issues$`)),
      });

      const stranger = await signUp();
      const other = await looseApp.inject({
        method: "POST",
        url: `/api/projects/${project.id}/alerts/test`,
        headers: { cookie: stranger },
      });
      expect(other.statusCode).toBe(404);
    });
  });
});
