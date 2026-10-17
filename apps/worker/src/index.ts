import { createPrismaClient } from "@mini-sentry/db";
import {
  ALERTS_QUEUE,
  EVENTS_DEAD_LETTER_QUEUE,
  EVENTS_QUEUE,
  type AlertJobData,
  type DeadLetterJobData,
  type IngestJobData,
} from "@mini-sentry/shared";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { deliverAlert, type AlertResult } from "./alerts.js";
import { loadConfig } from "./config.js";
import { processEvent, type ProcessResult } from "./process-event.js";

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);

// Workers block on Redis, so commands must wait for a reconnect instead of failing.
const workerConnection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const deadLetterConnection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const deadLetter = new Queue<DeadLetterJobData>(EVENTS_DEAD_LETTER_QUEUE, {
  connection: deadLetterConnection,
});

const alertsConnection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const alerts = new Queue<AlertJobData>(ALERTS_QUEUE, {
  connection: alertsConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { age: 24 * 3600 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

const worker = new Worker<IngestJobData, ProcessResult>(
  EVENTS_QUEUE,
  async (job) => {
    const result = await processEvent(prisma, job.data);
    if (result.status === "stored" && (result.newIssue || result.regressed)) {
      // Alerts go to their own queue: a slow or failing webhook gets its own retries and never
      // holds up grouping. The event is already committed at this point; if this enqueue fails,
      // the job retries, finds the event stored, and the alert is lost. A transactional outbox
      // would close that gap.
      await alerts.add(
        "alert",
        {
          kind: result.newIssue ? "new_issue" : "regression",
          projectId: job.data.projectId,
          issueId: result.issueId,
          eventId: job.data.event.eventId,
        },
        { jobId: `alert-${job.data.event.eventId}` },
      );
    }
    return result;
  },
  { connection: workerConnection, concurrency: config.WORKER_CONCURRENCY },
);

const alertWorkerConnection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const alertWorker = new Worker<AlertJobData, AlertResult>(
  ALERTS_QUEUE,
  (job) =>
    deliverAlert(
      {
        prisma,
        dashboardUrl: config.DASHBOARD_URL,
        policy: { allowAnyHost: config.WEBHOOK_ALLOW_ANY_HOST },
      },
      job.data,
    ),
  { connection: alertWorkerConnection, concurrency: 5 },
);
alertWorker.on("completed", (job, result) =>
  console.info(`alert ${job.data.kind} for issue ${job.data.issueId}: ${result}`),
);
alertWorker.on("failed", (job, err) =>
  console.warn(`alert ${job?.id}: attempt ${job?.attemptsMade} failed: ${err.message}`),
);
alertWorker.on("error", (err) => console.error("alert worker error", err));

worker.on("completed", (job, result) => {
  if (result.status !== "stored") console.info(`event ${job.id}: ${result.status}`);
});

// Retries (attempts + exponential backoff) are set by the producer. Once they run out, park the
// event in a separate queue so it can be inspected and replayed instead of disappearing.
worker.on("failed", (job, err) => {
  if (!job) return;
  const attempts = job.opts.attempts ?? 1;
  if (job.attemptsMade < attempts) {
    console.warn(`event ${job.id}: attempt ${job.attemptsMade}/${attempts} failed: ${err.message}`);
    return;
  }
  console.error(`event ${job.id}: giving up after ${job.attemptsMade} attempts: ${err.message}`);
  void deadLetter
    .add(
      "dead",
      { ...job.data, failedReason: err.message, attemptsMade: job.attemptsMade },
      { jobId: job.id, removeOnComplete: false, removeOnFail: false },
    )
    .catch((dlqErr: unknown) => console.error("could not write to dead-letter queue", dlqErr));
});

worker.on("error", (err) => console.error("worker error", err));

console.info(`worker listening on "${EVENTS_QUEUE}" (concurrency ${config.WORKER_CONCURRENCY})`);

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    // close() waits for in-flight jobs; anything interrupted harder than this is picked up again
    // by BullMQ's stalled-job check and deduplicated by eventId.
    void Promise.all([worker.close(), alertWorker.close()])
      .then(() => Promise.all([deadLetter.close(), alerts.close()]))
      .then(() => prisma.$disconnect())
      .finally(() => process.exit(0));
  });
}
