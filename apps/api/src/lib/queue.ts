import { EVENTS_QUEUE, type IngestJobData } from "@mini-sentry/shared";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

export type EventsQueue = Pick<Queue<IngestJobData>, "add" | "close">;

/**
 * Redis client for request handling. It fails fast when Redis is down instead of buffering
 * commands, so the API can answer 503 and the SDK's caller is not held open.
 */
export function createRedis(redisUrl: string): Redis {
  return new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
}

export function createEventsQueue(connection: Redis): Queue<IngestJobData> {
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
