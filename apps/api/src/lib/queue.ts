import { EVENTS_QUEUE, type IngestJobData } from "@mini-sentry/shared";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

export type EventsQueue = Pick<Queue<IngestJobData>, "add" | "close">;

export function createEventsQueue(redisUrl: string): Queue<IngestJobData> {
  // Fail fast when Redis is down instead of buffering commands, so the API can answer 503 and
  // the SDK's caller is not held open.
  const connection = new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  return new Queue<IngestJobData>(EVENTS_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { age: 3600, count: 10_000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
}
