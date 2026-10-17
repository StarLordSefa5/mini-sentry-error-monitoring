import type { ErrorEvent } from "@mini-sentry/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ProjectKeyCache } from "../lib/project-keys.js";
import type { EventsQueue } from "../lib/queue.js";
import type { RateLimiter } from "../lib/rate-limit.js";

const frameSchema = z.object({
  filename: z.string().max(2048),
  function: z.string().max(1024).optional(),
  lineno: z.number().int().nonnegative().optional(),
  colno: z.number().int().nonnegative().optional(),
});

const breadcrumbSchema = z.object({
  type: z.enum(["click", "navigation", "fetch", "console", "custom"]),
  timestamp: z.iso.datetime({ offset: true }),
  message: z.string().max(1024),
  level: z.enum(["debug", "info", "warning", "error"]).optional(),
  data: z
    .record(z.string().max(64), z.union([z.string().max(1024), z.number(), z.boolean(), z.null()]))
    .refine((d) => Object.keys(d).length <= 20, "Too many data fields")
    .optional(),
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
  breadcrumbs: z.array(breadcrumbSchema).max(100).optional(),
}) satisfies z.ZodType<ErrorEvent>;

const ingestParams = z.object({ projectId: z.string().min(1) });
const ingestQuery = z.object({ key: z.string().optional() });

export const KEY_HEADER = "x-mini-sentry-key";

/**
 * Public, CORS-open endpoint the SDK posts to. It is authenticated only by the project's API key,
 * which can be passed as a header or as `?key=` (navigator.sendBeacon cannot set headers).
 */
interface IngestRoutesOptions {
  keys: ProjectKeyCache;
  queue: EventsQueue;
  rateLimiter: RateLimiter;
}

export const ingestRoutes: FastifyPluginAsync<IngestRoutesOptions> = async (
  app,
  { keys, queue, rateLimiter },
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
    // Lets the browser SDK read when it may send again after a 429.
    reply.header(
      "access-control-expose-headers",
      "retry-after, x-ratelimit-limit, x-ratelimit-remaining",
    );
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

    // A valid key for a different project is rejected too.
    if ((await keys.resolve(key)) !== projectId) {
      return reply.code(401).send({ error: "invalid_api_key" });
    }

    // Counted after the key check, so invalid keys cannot use up a project's budget.
    let limit;
    try {
      limit = await rateLimiter.hit(projectId);
    } catch (err) {
      request.log.error(err, "rate limiter unavailable");
      return reply.code(503).send({ error: "unavailable" });
    }
    reply.header("x-ratelimit-limit", limit.limit).header("x-ratelimit-remaining", limit.remaining);
    if (!limit.allowed) {
      // An app stuck in an error loop is stopped here, before it can fill the queue.
      return reply
        .code(429)
        .header("retry-after", limit.resetSeconds)
        .send({ error: "rate_limited", retryAfter: limit.resetSeconds });
    }

    const event = eventSchema.parse(request.body);
    try {
      // jobId = eventId: BullMQ ignores a second add while the first job is retained, and the
      // worker's unique eventId check covers the rest.
      await queue.add(
        "event",
        { projectId, event, receivedAt: new Date().toISOString() },
        { jobId: event.eventId },
      );
    } catch (err) {
      request.log.error(err, "failed to enqueue event");
      return reply.code(503).send({ error: "unavailable" });
    }
    // Accepted, not yet stored: grouping happens in the worker.
    return reply.code(202).send({ eventId: event.eventId });
  });
};
