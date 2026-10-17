import { Prisma, type PrismaClient } from "@mini-sentry/db";
import type { ErrorEvent } from "@mini-sentry/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const frameSchema = z.object({
  filename: z.string().max(2048),
  function: z.string().max(1024).optional(),
  lineno: z.number().int().nonnegative().optional(),
  colno: z.number().int().nonnegative().optional(),
});

const eventSchema = z.object({
  eventId: z.uuid(),
  timestamp: z.iso.datetime({ offset: true }),
  platform: z.enum(["browser", "node"]),
  type: z.string().min(1).max(256),
  message: z.string().max(8192),
  stack: z.string().max(65536).optional(),
  frames: z.array(frameSchema).max(200),
  url: z.string().max(2048).optional(),
  userAgent: z.string().max(1024).optional(),
  release: z.string().max(256).optional(),
  environment: z.string().max(64).optional(),
}) satisfies z.ZodType<ErrorEvent>;

const ingestParams = z.object({ projectId: z.string().min(1) });
const ingestQuery = z.object({ key: z.string().optional() });

export const KEY_HEADER = "x-mini-sentry-key";

/**
 * Public, CORS-open endpoint the SDK posts to. It is authenticated only by the project's API key,
 * which can be passed as a header or as `?key=` (navigator.sendBeacon cannot set headers).
 */
export const ingestRoutes: FastifyPluginAsync<{ prisma: PrismaClient }> = async (
  app,
  { prisma },
) => {
  // The SDK sends JSON as text/plain: that keeps the request "simple", so browsers skip the
  // CORS preflight and sendBeacon works.
  app.removeContentTypeParser("text/plain");
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_request, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error("Body is not valid JSON"), { statusCode: 400 }), undefined);
    }
  });

  app.addHook("onSend", async (_request, reply) => {
    reply.header("access-control-allow-origin", "*");
  });

  app.options("/:projectId/events", async (_request, reply) => {
    return reply
      .header("access-control-allow-methods", "POST, OPTIONS")
      .header("access-control-allow-headers", `content-type, ${KEY_HEADER}`)
      .header("access-control-max-age", "86400")
      .code(204)
      .send();
  });

  app.post("/:projectId/events", { bodyLimit: 256 * 1024 }, async (request, reply) => {
    const { projectId } = ingestParams.parse(request.params);
    const headerKey = request.headers[KEY_HEADER];
    const key =
      (typeof headerKey === "string" ? headerKey : undefined) ??
      ingestQuery.parse(request.query).key;
    if (!key) return reply.code(401).send({ error: "missing_api_key" });

    const project = await prisma.project.findUnique({
      where: { apiKey: key },
      select: { id: true },
    });
    // A valid key for a different project is rejected too.
    if (!project || project.id !== projectId) {
      return reply.code(401).send({ error: "invalid_api_key" });
    }

    const event = eventSchema.parse(request.body);
    try {
      await prisma.event.create({
        data: { ...event, timestamp: new Date(event.timestamp), projectId },
      });
    } catch (err) {
      // Same eventId already stored: the SDK retried. Accept without storing twice.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return { eventId: event.eventId, duplicate: true };
      }
      throw err;
    }
    return { eventId: event.eventId };
  });
};
