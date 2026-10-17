import { Prisma, type PrismaClient } from "@mini-sentry/db";
import type {
  EventDto,
  IssueDetailResponse,
  IssueDto,
  IssueListResponse,
  IssueStatsResponse,
  StackFrame,
} from "@mini-sentry/shared";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const projectParams = z.object({ projectId: z.string().min(1) });
const issueParams = projectParams.extend({ issueId: z.string().min(1) });

const listQuery = z.object({
  status: z.enum(["unresolved", "resolved", "ignored", "all"]).default("unresolved"),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(["lastSeen", "firstSeen", "count"]).default("lastSeen"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const eventsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const statsQuery = z.object({ range: z.enum(["24h", "7d"]).default("24h") });

const updateBody = z.object({ status: z.enum(["unresolved", "resolved", "ignored"]) });

const issueSelect = {
  id: true,
  type: true,
  message: true,
  culprit: true,
  status: true,
  count: true,
  firstSeen: true,
  lastSeen: true,
} as const satisfies Prisma.IssueSelect;

type IssueRow = Prisma.IssueGetPayload<{ select: typeof issueSelect }>;
type EventRow = Prisma.EventGetPayload<object>;

function toIssueDto(issue: IssueRow): IssueDto {
  return {
    ...issue,
    firstSeen: issue.firstSeen.toISOString(),
    lastSeen: issue.lastSeen.toISOString(),
  };
}

function toEventDto(event: EventRow): EventDto {
  return {
    id: event.id,
    eventId: event.eventId,
    platform: event.platform as EventDto["platform"],
    type: event.type,
    message: event.message,
    stack: event.stack,
    frames: event.frames as unknown as StackFrame[],
    url: event.url,
    userAgent: event.userAgent,
    release: event.release,
    environment: event.environment,
    timestamp: event.timestamp.toISOString(),
    receivedAt: event.receivedAt.toISOString(),
  };
}

const RANGES = {
  "24h": { unit: "hour", step: "1 hour", buckets: 24 },
  "7d": { unit: "day", step: "1 day", buckets: 7 },
} as const;

/** Issue routes, mounted under /api/projects/:projectId/issues behind the session check. */
export const issueRoutes: FastifyPluginAsync<{ prisma: PrismaClient }> = async (
  app,
  { prisma },
) => {
  /** Sends 404 and returns false unless the logged-in user owns the project. */
  async function ownsProject(request: FastifyRequest, reply: FastifyReply, projectId: string) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: request.user!.id },
      select: { id: true },
    });
    if (!project) await reply.code(404).send({ error: "not_found" });
    return project !== null;
  }

  app.get("/", async (request, reply): Promise<IssueListResponse | undefined> => {
    const { projectId } = projectParams.parse(request.params);
    const { status, q, sort, page, limit } = listQuery.parse(request.query);
    if (!(await ownsProject(request, reply, projectId))) return;

    const where: Prisma.IssueWhereInput = {
      projectId,
      ...(status === "all" ? {} : { status }),
      ...(q
        ? {
            OR: [
              { message: { contains: q, mode: "insensitive" } },
              { type: { contains: q, mode: "insensitive" } },
              { culprit: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [issues, total] = await Promise.all([
      prisma.issue.findMany({
        where,
        select: issueSelect,
        // id as a tie-breaker keeps pages stable when timestamps or counts are equal.
        orderBy: [{ [sort]: "desc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.issue.count({ where }),
    ]);
    return { issues: issues.map(toIssueDto), total, page, limit };
  });

  app.get("/:issueId", async (request, reply): Promise<IssueDetailResponse | undefined> => {
    const { projectId, issueId } = issueParams.parse(request.params);
    if (!(await ownsProject(request, reply, projectId))) return;

    const issue = await prisma.issue.findFirst({
      where: { id: issueId, projectId },
      select: issueSelect,
    });
    if (!issue) return reply.code(404).send({ error: "not_found" });

    const latestEvent = await prisma.event.findFirst({
      where: { issueId },
      orderBy: { receivedAt: "desc" },
    });
    return { issue: toIssueDto(issue), latestEvent: latestEvent && toEventDto(latestEvent) };
  });

  app.get("/:issueId/events", async (request, reply) => {
    const { projectId, issueId } = issueParams.parse(request.params);
    const { limit } = eventsQuery.parse(request.query);
    if (!(await ownsProject(request, reply, projectId))) return;

    const events = await prisma.event.findMany({
      where: { issueId, projectId },
      orderBy: { receivedAt: "desc" },
      take: limit,
    });
    return { events: events.map(toEventDto) };
  });

  app.get("/:issueId/stats", async (request, reply): Promise<IssueStatsResponse | undefined> => {
    const { projectId, issueId } = issueParams.parse(request.params);
    const { range } = statsQuery.parse(request.query);
    if (!(await ownsProject(request, reply, projectId))) return;

    const { unit, step, buckets } = RANGES[range];
    // Timestamps are stored as UTC without a zone, so bucket in UTC too. generate_series fills
    // the empty hours/days, which keeps the chart's x axis continuous.
    const rows = await prisma.$queryRaw<{ start: Date; count: number }[]>`
      WITH bucket AS (
        SELECT generate_series(
          date_trunc(${unit}, now() AT TIME ZONE 'UTC') - (${buckets - 1} * ${step}::interval),
          date_trunc(${unit}, now() AT TIME ZONE 'UTC'),
          ${step}::interval
        ) AS start
      )
      SELECT bucket.start, COUNT(e."id")::int AS count
      FROM bucket
      LEFT JOIN "Event" e
        ON e."issueId" = ${issueId}
        AND e."projectId" = ${projectId}
        AND e."receivedAt" >= bucket.start
        AND e."receivedAt" < bucket.start + ${step}::interval
      GROUP BY bucket.start
      ORDER BY bucket.start
    `;
    return {
      range,
      buckets: rows.map((r) => ({ start: r.start.toISOString(), count: r.count })),
    };
  });

  app.patch("/:issueId", async (request, reply) => {
    const { projectId, issueId } = issueParams.parse(request.params);
    const { status } = updateBody.parse(request.body);
    if (!(await ownsProject(request, reply, projectId))) return;

    const { count } = await prisma.issue.updateMany({
      where: { id: issueId, projectId },
      data: { status },
    });
    if (count === 0) return reply.code(404).send({ error: "not_found" });

    const issue = await prisma.issue.findUniqueOrThrow({
      where: { id: issueId },
      select: issueSelect,
    });
    return { issue: toIssueDto(issue) };
  });
};
