import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRedisRateLimiter } from "./rate-limit.js";

// Needs the Redis from docker-compose (`pnpm infra:up`).
try {
  process.loadEnvFile("../../.env");
} catch {
  // Use the environment as is.
}
const redisUrl = process.env.REDIS_URL;

describe.skipIf(!redisUrl)("createRedisRateLimiter", () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(redisUrl!);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("lets exactly the limit through, even under concurrency", async () => {
    const limiter = createRedisRateLimiter(redis, 10);
    const project = `test-${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 25 }, () => limiter.hit(project)));

    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(Math.min(...results.map((r) => r.remaining))).toBe(0);
    for (const r of results) {
      expect(r.resetSeconds).toBeGreaterThan(0);
      expect(r.resetSeconds).toBeLessThanOrEqual(60);
    }
  });

  it("counts each project separately", async () => {
    const limiter = createRedisRateLimiter(redis, 1);
    expect((await limiter.hit(`a-${randomUUID()}`)).allowed).toBe(true);
    expect((await limiter.hit(`b-${randomUUID()}`)).allowed).toBe(true);
  });
});
