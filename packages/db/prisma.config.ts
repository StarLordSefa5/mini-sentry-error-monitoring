import { defineConfig, env } from "prisma/config";

// Local development reads the shared .env at the repo root; deployments set real env vars.
try {
  process.loadEnvFile("../../.env");
} catch {
  // No .env file: rely on the environment.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
