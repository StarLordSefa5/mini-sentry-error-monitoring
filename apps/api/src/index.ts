import { createPrismaClient } from "@mini-sentry/db";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createEventsQueue, createRedis } from "./lib/queue.js";
import { createRedisRateLimiter } from "./lib/rate-limit.js";

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const eventsQueue = createEventsQueue(redis);
const rateLimiter = createRedisRateLimiter(redis, config.RATE_LIMIT_PER_MINUTE);
const app = await buildApp({ config, prisma, eventsQueue, rateLimiter });

app.addHook("onClose", async () => {
  await eventsQueue.close();
  redis.disconnect();
  await prisma.$disconnect();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.PORT, host: "0.0.0.0" });
