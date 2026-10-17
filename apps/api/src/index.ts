import { createPrismaClient } from "@mini-sentry/db";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const app = await buildApp({ config, prisma });

app.addHook("onClose", async () => {
  await prisma.$disconnect();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.PORT, host: "0.0.0.0" });
