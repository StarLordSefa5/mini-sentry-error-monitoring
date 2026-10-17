import { createPrismaClient } from "@mini-sentry/db";
import {
  EVENTS_DEAD_LETTER_QUEUE,
  EVENTS_QUEUE,
  type DeadLetterJobData,
  type IngestJobData,
} from "@mini-sentry/shared";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
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

const worker = new Worker<IngestJobData, ProcessResult>(
  EVENTS_QUEUE,
  (job) => processEvent(prisma, job.data),
  { connection: workerConnection, concurrency: config.WORKER_CONCURRENCY },
);

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
    void worker
      .close()
      .then(() => deadLetter.close())
      .then(() => prisma.$disconnect())
      .finally(() => process.exit(0));
  });
}
