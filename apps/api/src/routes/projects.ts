import type { PrismaClient } from "@mini-sentry/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { generateApiKey } from "../lib/tokens.js";
import { requireUser } from "../plugins/session.js";

const createProjectBody = z.object({
  name: z.string().trim().min(1).max(100),
});

const projectParams = z.object({
  projectId: z.string().min(1),
});

interface ProjectRoutesOptions {
  prisma: PrismaClient;
  publicUrl: string;
}

const projectSelect = { id: true, name: true, apiKey: true, createdAt: true } as const;

export const projectRoutes: FastifyPluginAsync<ProjectRoutesOptions> = async (
  app,
  { prisma, publicUrl },
) => {
  // Project management is session-only. The public API key can write events, nothing else.
  app.addHook("preHandler", requireUser);

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

  app.post("/:projectId/api-key/rotate", async (request, reply) => {
    const { projectId } = projectParams.parse(request.params);
    const { count } = await prisma.project.updateMany({
      where: { id: projectId, ownerId: request.user!.id },
      data: { apiKey: generateApiKey() },
    });
    if (count === 0) return reply.code(404).send({ error: "not_found" });

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: projectSelect,
    });
    return { project: withDsn(project) };
  });
};
