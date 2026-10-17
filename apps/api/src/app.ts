import type { PrismaClient } from "@mini-sentry/db";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import { sessionPlugin } from "./plugins/session.js";
import { authRoutes } from "./routes/auth.js";
import { projectRoutes } from "./routes/projects.js";

export interface AppDeps {
  config: Config;
  prisma: PrismaClient;
}

export async function buildApp({ config, prisma }: AppDeps): Promise<FastifyInstance> {
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

  await app.register(sessionPlugin, { prisma, secureCookie: config.COOKIE_SECURE });

  app.get("/health", async () => ({ status: "ok" }));
  await app.register(authRoutes, { prefix: "/api/auth", prisma });
  await app.register(projectRoutes, {
    prefix: "/api/projects",
    prisma,
    publicUrl: config.PUBLIC_URL,
  });

  return app;
}
