import { Prisma, type PrismaClient } from "@mini-sentry/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "../lib/password.js";
import { requireUser } from "../plugins/session.js";

const email = z.string().trim().toLowerCase().pipe(z.email());

const registerBody = z.object({
  email,
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(100).optional(),
});

const loginBody = z.object({
  email,
  password: z.string().min(1).max(200),
});

export const authRoutes: FastifyPluginAsync<{ prisma: PrismaClient }> = async (app, { prisma }) => {
  app.post("/register", async (request, reply) => {
    const body = registerBody.parse(request.body);

    try {
      const user = await prisma.user.create({
        data: {
          email: body.email,
          name: body.name,
          passwordHash: await hashPassword(body.password),
        },
        select: { id: true, email: true, name: true },
      });
      await reply.startSession(user.id);
      return reply.code(201).send({ user });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "email_taken" });
      }
      throw err;
    }
  });

  app.post("/login", async (request, reply) => {
    const body = loginBody.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    const valid = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !valid) {
      // Same response for unknown email and wrong password, so accounts cannot be enumerated.
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    await reply.startSession(user.id);
    return { user: { id: user.id, email: user.email, name: user.name } };
  });

  app.post("/logout", async (_request, reply) => {
    await reply.endSession();
    return reply.code(204).send();
  });

  app.get("/me", { preHandler: requireUser }, async (request) => ({ user: request.user }));
};
