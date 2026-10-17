import type { PrismaClient } from "@mini-sentry/db";
import { checkWebhookUrl, sendWebhook, type WebhookPolicy } from "@mini-sentry/notify";
import type { SourceMapReleaseDto } from "@mini-sentry/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ProjectKeyCache } from "../lib/project-keys.js";
import { generateApiKey, randomToken, sha256 } from "../lib/tokens.js";
import { requireUser } from "../plugins/session.js";
import { issueRoutes } from "./issues.js";

const createProjectBody = z.object({
  name: z.string().trim().min(1).max(100),
});

const updateProjectBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    // Empty string or null turns alerts off.
    alertWebhookUrl: z
      .string()
      .trim()
      .max(2048)
      .nullable()
      .transform((v) => v || null),
  })
  .partial();

const projectParams = z.object({
  projectId: z.string().min(1),
});

interface ProjectRoutesOptions {
  prisma: PrismaClient;
  keys: ProjectKeyCache;
  publicUrl: string;
  dashboardUrl: string;
  webhookPolicy: WebhookPolicy;
}

const projectSelect = {
  id: true,
  name: true,
  apiKey: true,
  alertWebhookUrl: true,
  uploadTokenHash: true,
  createdAt: true,
} as const;

export const projectRoutes: FastifyPluginAsync<ProjectRoutesOptions> = async (
  app,
  { prisma, keys, publicUrl, dashboardUrl, webhookPolicy },
) => {
  // Project management is session-only. The public API key can write events, nothing else.
  app.addHook("preHandler", requireUser);

  await app.register(issueRoutes, { prefix: "/:projectId/issues", prisma });

  // DSN in Sentry's format: <protocol>://<publicKey>@<host>/<projectId>
  const withDsn = <T extends { id: string; apiKey: string; uploadTokenHash: string | null }>({
    uploadTokenHash,
    ...project
  }: T) => {
    const url = new URL(publicUrl);
    url.username = project.apiKey;
    url.pathname = `/${project.id}`;
    // The hash never leaves the server; the dashboard only needs to know a token exists.
    return { ...project, hasUploadToken: uploadTokenHash !== null, dsn: url.toString() };
  };

  app.get("/", async (request) => {
    const projects = await prisma.project.findMany({
      where: { ownerId: request.user!.id },
      select: projectSelect,
      orderBy: { createdAt: "asc" },
    });
    return { projects: projects.map(withDsn) };
  });

  app.post("/", async (request, reply) => {
    const body = createProjectBody.parse(request.body);
    const project = await prisma.project.create({
      data: { name: body.name, apiKey: generateApiKey(), ownerId: request.user!.id },
      select: projectSelect,
    });
    return reply.code(201).send({ project: withDsn(project) });
  });

  app.get("/:projectId", async (request, reply) => {
    const { projectId } = projectParams.parse(request.params);
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: request.user!.id },
      select: projectSelect,
    });
    // 404 rather than 403 so other users' project ids are not confirmed.
    if (!project) return reply.code(404).send({ error: "not_found" });
    return { project: withDsn(project) };
  });

  app.patch("/:projectId", async (request, reply) => {
    const { projectId } = projectParams.parse(request.params);
    const body = updateProjectBody.parse(request.body);
    if (body.alertWebhookUrl) {
      const check = checkWebhookUrl(body.alertWebhookUrl, webhookPolicy);
      if (!check.ok)
        return reply.code(400).send({ error: "invalid_webhook", message: check.reason });
    }

    const { count } = await prisma.project.updateMany({
      where: { id: projectId, ownerId: request.user!.id },
      data: body,
    });
    if (count === 0) return reply.code(404).send({ error: "not_found" });

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: projectSelect,
    });
    return { project: withDsn(project) };
  });

  // Sends a sample alert right away, so the user sees at once whether the webhook works.
  app.post("/:projectId/alerts/test", async (request, reply) => {
    const { projectId } = projectParams.parse(request.params);
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: request.user!.id },
      select: { name: true, alertWebhookUrl: true },
    });
    if (!project) return reply.code(404).send({ error: "not_found" });
    if (!project.alertWebhookUrl) return reply.code(400).send({ error: "no_webhook" });

    try {
      await sendWebhook(
        project.alertWebhookUrl,
        {
          kind: "test",
          projectName: project.name,
          issue: {
            type: "TestError",
            message: "Alerts are set up. New issues and regressions will show up here.",
            culprit: null,
            count: 1,
          },
          url: `${dashboardUrl}/projects/${projectId}/issues`,
        },
        webhookPolicy,
      );
    } catch (err) {
      return reply.code(502).send({ error: "webhook_failed", message: (err as Error).message });
    }
    return reply.code(204).send();
  });

  // Creates (or replaces) the secret token CI uses to upload source maps. It is returned once;
  // only its hash is stored.
  app.post("/:projectId/upload-token", async (request, reply) => {
    const { projectId } = projectParams.parse(request.params);
    const token = `mss_${randomToken(32)}`;
    const { count } = await prisma.project.updateMany({
      where: { id: projectId, ownerId: request.user!.id },
      data: { uploadTokenHash: sha256(token) },
    });
    if (count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(201).send({ token });
  });

  app.get("/:projectId/sourcemaps", async (request, reply) => {
    const { projectId } = projectParams.parse(request.params);
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: request.user!.id },
      select: { id: true },
    });
    if (!project) return reply.code(404).send({ error: "not_found" });

    const groups = await prisma.sourceMap.groupBy({
      by: ["release"],
      where: { projectId },
      _count: { _all: true },
      _sum: { size: true },
      _max: { updatedAt: true },
      orderBy: { _max: { updatedAt: "desc" } },
      take: 20,
    });
    const releases: SourceMapReleaseDto[] = groups.map((g) => ({
      release: g.release,
      files: g._count._all,
      bytes: g._sum.size ?? 0,
      lastUploadAt: (g._max.updatedAt ?? new Date(0)).toISOString(),
    }));
    return { releases };
  });

  app.delete("/:projectId/sourcemaps/:release", async (request, reply) => {
    const { projectId, release } = projectParams
      .extend({ release: z.string().min(1).max(256) })
      .parse(request.params);
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: request.user!.id },
      select: { id: true },
    });
    if (!project) return reply.code(404).send({ error: "not_found" });
    await prisma.sourceMap.deleteMany({ where: { projectId, release } });
    return reply.code(204).send();
  });

  app.post("/:projectId/api-key/rotate", async (request, reply) => {
    const { projectId } = projectParams.parse(request.params);
    const current = await prisma.project.findFirst({
      where: { id: projectId, ownerId: request.user!.id },
      select: { apiKey: true },
    });
    if (!current) return reply.code(404).send({ error: "not_found" });

    const project = await prisma.project.update({
      where: { id: projectId },
      data: { apiKey: generateApiKey() },
      select: projectSelect,
    });
    // Other API instances keep accepting the old key until their cache entry expires.
    keys.invalidate(current.apiKey);
    return { project: withDsn(project) };
  });
};
