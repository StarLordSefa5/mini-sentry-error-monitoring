import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url().default("redis://localhost:6379"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  /** Base URL of the dashboard, used for links in alerts. */
  DASHBOARD_URL: z.url().default("http://localhost:5173"),
  /** Development only: allow any http(s) webhook URL, not just Discord and Slack. */
  WEBHOOK_ALLOW_ANY_HOST: z.stringbool().default(false),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
