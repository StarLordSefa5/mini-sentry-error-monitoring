import type { PrismaClient } from "@mini-sentry/db";
import { checkWebhookUrl, sendWebhook, type WebhookPolicy } from "@mini-sentry/notify";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ProjectKeyCache } from "../lib/project-keys.js";
import { generateApiKey } from "../lib/tokens.js";
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
  const withDsn = <T extends { id: string; apiKey: string }>(project: T) => {
    const url = new URL(publicUrl);
    url.username = project.apiKey;
    url.pathname = `/${project.id}`;
    return { ...project, dsn: url.toString() };
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
