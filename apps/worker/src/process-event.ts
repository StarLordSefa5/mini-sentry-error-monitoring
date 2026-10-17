import { Prisma, type PrismaClient } from "@mini-sentry/db";
import type { IngestJobData } from "@mini-sentry/shared";
import { culprit, fingerprint } from "./fingerprint.js";

export type ProcessResult =
  | { status: "stored"; issueId: string; newIssue: boolean }
  /** This eventId was already stored: a retried job or a re-sent beacon. Nothing changed. */
  | { status: "duplicate" }
  /** The project was deleted after the event was accepted. Retrying cannot help. */
  | { status: "dropped" };

/**
 * Stores one event and attaches it to its issue. Safe to run more than once for the same event:
 * the issue upsert and the event insert share a transaction, and Event.eventId is unique, so a
 * repeat rolls back its own count increment.
 */
export async function processEvent(
  prisma: PrismaClient,
  job: IngestJobData,
): Promise<ProcessResult> {
  const { projectId, event, receivedAt } = job;

  // Cheap early exit for the common repeat case; the unique index is the real guarantee.
  const existing = await prisma.event.findUnique({
    where: { eventId: event.eventId },
    select: { id: true },
  });
  if (existing) return { status: "duplicate" };

  const hash = fingerprint(event);
  // Server time, not the client's clock, so a wrong device clock cannot move first/last seen.
  const seenAt = new Date(receivedAt).toISOString();

  try {
    return await prisma.$transaction(async (tx) => {
      // One statement, so concurrent events for the same issue cannot lose an increment or move
      // lastSeen backwards (jobs can finish out of order).
      const [issue] = await tx.$queryRaw<{ id: string; inserted: boolean }[]>`
        INSERT INTO "Issue" ("projectId", "fingerprint", "type", "message", "culprit", "count", "firstSeen", "lastSeen")
        VALUES (
          ${projectId}, ${hash}, ${event.type}, ${event.message}, ${culprit(event.frames)}, 1,
          (${seenAt}::timestamptz AT TIME ZONE 'UTC'), (${seenAt}::timestamptz AT TIME ZONE 'UTC')
        )
        ON CONFLICT ("projectId", "fingerprint") DO UPDATE SET
          "count" = "Issue"."count" + 1,
          "firstSeen" = LEAST("Issue"."firstSeen", EXCLUDED."firstSeen"),
          "lastSeen" = GREATEST("Issue"."lastSeen", EXCLUDED."lastSeen")
        RETURNING "id", (xmax = 0) AS "inserted"
      `;
      if (!issue) throw new Error("Issue upsert returned no row");

      await tx.event.create({
        data: {
          ...event,
          // StackFrame is plain JSON, but as an interface it has no index signature for Prisma.
          frames: event.frames as unknown as Prisma.InputJsonValue,
          timestamp: new Date(event.timestamp),
          receivedAt: new Date(seenAt),
          projectId,
          issueId: issue.id,
        },
      });
      return { status: "stored", issueId: issue.id, newIssue: issue.inserted };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { status: "duplicate" };
    }
    if (isForeignKeyViolation(err)) return { status: "dropped" };
    throw err;
  }
}

function isForeignKeyViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") return true;
  // Raw queries fail with the generic P2010; the driver adapter carries the Postgres code.
  const meta = (err as { meta?: { driverAdapterError?: { cause?: { originalCode?: string } } } })
    .meta;
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2010" &&
    meta?.driverAdapterError?.cause?.originalCode === "23503"
  );
}
