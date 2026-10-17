import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url().default("redis://localhost:6379"),
  PUBLIC_URL: z.url().default("http://localhost:4000"),
  /** Base URL of the dashboard, used for links in alerts. */
  DASHBOARD_URL: z.url().default("http://localhost:5173"),
  COOKIE_SECURE: z.stringbool().default(false),
  /** Events accepted per project per minute; the rest get 429. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(1000),
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
