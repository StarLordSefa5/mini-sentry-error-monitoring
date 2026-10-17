import cookie from "@fastify/cookie";
import type { PrismaClient } from "@mini-sentry/db";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { randomToken, sha256 } from "../lib/tokens.js";

export const SESSION_COOKIE = "ms_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
  interface FastifyReply {
    startSession(userId: string): Promise<void>;
    endSession(): Promise<void>;
  }
}

interface SessionPluginOptions {
  prisma: PrismaClient;
  secureCookie: boolean;
}

/**
 * Cookie sessions for the dashboard. The browser gets an HTTP-only random token; the database
 * stores only its hash, so a leaked sessions table cannot be replayed.
 */
export const sessionPlugin = fp<SessionPluginOptions>(async (app, { prisma, secureCookie }) => {
  await app.register(cookie);

  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
  } as const;

  app.decorateRequest("user", null);

  app.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;

    const session = await prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      select: { expiresAt: true, user: { select: { id: true, email: true, name: true } } },
    });
    if (session && session.expiresAt > new Date()) {
      request.user = session.user;
    }
  });

  app.decorateReply("startSession", async function (this: FastifyReply, userId: string) {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.session.create({ data: { tokenHash: sha256(token), userId, expiresAt } });
    this.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
  });

  app.decorateReply("endSession", async function (this: FastifyReply) {
    const token = this.request.cookies[SESSION_COOKIE];
    if (token) {
      await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
    }
    this.clearCookie(SESSION_COOKIE, cookieOptions);
  });
});

/** preHandler for routes that need a logged-in user. API keys are never accepted here. */
export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    await reply.code(401).send({ error: "unauthorized" });
  }
}
