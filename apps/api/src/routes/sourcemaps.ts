import { timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@mini-sentry/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { sha256 } from "../lib/tokens.js";

const params = z.object({
  projectId: z.string().min(1),
  release: z.string().min(1).max(256),
});

const query = z.object({
  /** URL path of the minified file, e.g. /assets/index-BxK3a9Qz.js */
  file: z.string().startsWith("/").max(1024),
});

// Only the parts we read; the rest of the map is stored as is.
const sourceMapSchema = z.looseObject({
  version: z.literal(3),
  mappings: z.string(),
  sources: z.array(z.string()),
});

const MAX_MAP_BYTES = 50 * 1024 * 1024;

/**
 * Source map upload for CI. Authenticated by the project's secret upload token, never by the
 * public API key: anyone can read the API key from a website's JavaScript, and a forged map could
 * make stack traces lie.
 */
export const sourcemapRoutes: FastifyPluginAsync<{ prisma: PrismaClient }> = async (
  app,
  { prisma },
) => {
  app.put(
    "/:projectId/releases/:release/sourcemaps",
    { bodyLimit: MAX_MAP_BYTES },
    async (request, reply) => {
      const { projectId, release } = params.parse(request.params);
      const { file } = query.parse(request.query);

      const header = request.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { uploadTokenHash: true },
      });
      const expected = Buffer.from(project?.uploadTokenHash ?? "0".repeat(64), "hex");
      const actual = Buffer.from(sha256(token), "hex");
      // Same response and same comparison for an unknown project or a wrong token.
      if (!token || !project?.uploadTokenHash || !timingSafeEqual(expected, actual)) {
        return reply.code(401).send({ error: "invalid_upload_token" });
      }

      const map = sourceMapSchema.parse(request.body);
      const content = JSON.stringify(map);
      await prisma.sourceMap.upsert({
        where: { projectId_release_filePath: { projectId, release, filePath: file } },
        create: { projectId, release, filePath: file, content, size: content.length },
        update: { content, size: content.length },
      });
      return reply.code(201).send({ release, file, sources: map.sources.length });
    },
  );
};
