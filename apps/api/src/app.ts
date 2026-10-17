import type { PrismaClient } from "@mini-sentry/db";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import { ProjectKeyCache } from "./lib/project-keys.js";
import type { EventsQueue } from "./lib/queue.js";
import type { RateLimiter } from "./lib/rate-limit.js";
import { sessionPlugin } from "./plugins/session.js";
import { authRoutes } from "./routes/auth.js";
import { ingestRoutes } from "./routes/ingest.js";
import { projectRoutes } from "./routes/projects.js";
import { sourcemapRoutes } from "./routes/sourcemaps.js";

export interface AppDeps {
  config: Config;
  prisma: PrismaClient;
  eventsQueue: EventsQueue;
  rateLimiter: RateLimiter;
}

export async function buildApp({
  config,
  prisma,
  eventsQueue,
  rateLimiter,
}: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.NODE_ENV === "test" ? "silent" : "info" },
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "validation_error", issues: err.issues });
    }
    const statusCode =
      typeof (err as { statusCode?: unknown }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : 500;
    if (statusCode >= 500) {
      request.log.error(err);
      return reply.code(500).send({ error: "internal_error" });
    }
    // Fastify's own client errors, e.g. malformed JSON.
    return reply.code(statusCode).send({ error: (err as Error).message });
  });

  app.get("/health", async () => ({ status: "ok" }));

  // Ingestion: API-key auth only. Kept outside the session scope so event writes never pay for a
  // session lookup.
  const keys = new ProjectKeyCache(prisma);
  await app.register(ingestRoutes, {
    prefix: "/api",
    keys,
    queue: eventsQueue,
    rateLimiter,
  });

  // Source map uploads from CI: secret upload token, no session.
  await app.register(sourcemapRoutes, { prefix: "/api", prisma });

  // Dashboard API: cookie sessions.
  await app.register(async (dashboard) => {
    await dashboard.register(sessionPlugin, { prisma, secureCookie: config.COOKIE_SECURE });
    await dashboard.register(authRoutes, { prefix: "/api/auth", prisma });
    await dashboard.register(projectRoutes, {
      prefix: "/api/projects",
      prisma,
      keys,
      publicUrl: config.PUBLIC_URL,
      dashboardUrl: config.DASHBOARD_URL,
      webhookPolicy: { allowAnyHost: config.WEBHOOK_ALLOW_ANY_HOST },
    });
  });

  return app;
}
