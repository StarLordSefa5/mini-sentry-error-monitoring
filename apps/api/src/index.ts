import { createPrismaClient } from "@mini-sentry/db";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createEventsQueue } from "./lib/queue.js";

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const eventsQueue = createEventsQueue(config.REDIS_URL);
const app = await buildApp({ config, prisma, eventsQueue });

app.addHook("onClose", async () => {
  await eventsQueue.close();
  await prisma.$disconnect();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.PORT, host: "0.0.0.0" });
