import type { PrismaClient } from "@mini-sentry/db";

interface Entry {
  projectId: string | null;
  expiresAt: number;
}

/**
 * In-memory cache of API key -> project id, so ingestion does not hit Postgres for every event.
 * Unknown keys are cached too (briefly), so a client spamming a bad key cannot hammer the DB.
 * A rotated key keeps working on this instance for up to `ttlMs`.
 */
export class ProjectKeyCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ttlMs = 60_000,
    private readonly negativeTtlMs = 10_000,
    private readonly maxEntries = 10_000,
  ) {}

  async resolve(apiKey: string): Promise<string | null> {
    const now = Date.now();
    const cached = this.entries.get(apiKey);
    if (cached && cached.expiresAt > now) return cached.projectId;

    const project = await this.prisma.project.findUnique({
      where: { apiKey },
      select: { id: true },
    });
    const projectId = project?.id ?? null;

    this.entries.delete(apiKey);
    if (this.entries.size >= this.maxEntries) {
      // Maps iterate in insertion order: drop the oldest entry.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(apiKey, {
      projectId,
      expiresAt: now + (projectId ? this.ttlMs : this.negativeTtlMs),
    });
    return projectId;
  }

  /** Drops a key immediately, e.g. after rotation on this instance. */
  invalidate(apiKey: string): void {
    this.entries.delete(apiKey);
  }
}
