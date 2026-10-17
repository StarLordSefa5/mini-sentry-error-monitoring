import type { Redis } from "ioredis";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window ends. */
  resetSeconds: number;
}

export interface RateLimiter {
  hit(projectId: string): Promise<RateLimitResult>;
}

const WINDOW_SECONDS = 60;

/**
 * Fixed one-minute window per project, counted in Redis so every API instance shares the same
 * budget. INCR is atomic, so concurrent requests cannot both slip under the limit. A fixed window
 * can let up to 2x the limit through around a window boundary; that is acceptable for protecting
 * the queue from an app stuck in an error loop.
 */
export function createRedisRateLimiter(redis: Redis, limitPerMinute: number): RateLimiter {
  return {
    async hit(projectId) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const window = Math.floor(nowSeconds / WINDOW_SECONDS);
      const key = `ratelimit:events:${projectId}:${window}`;

      const replies = await redis
        .multi()
        .incr(key)
        .expire(key, WINDOW_SECONDS * 2)
        .exec();
      const [err, count] = replies?.[0] ?? [new Error("empty MULTI reply"), 0];
      if (err) throw err;

      const used = Number(count);
      return {
        allowed: used <= limitPerMinute,
        limit: limitPerMinute,
        remaining: Math.max(0, limitPerMinute - used),
        resetSeconds: (window + 1) * WINDOW_SECONDS - nowSeconds,
      };
    },
  };
}
