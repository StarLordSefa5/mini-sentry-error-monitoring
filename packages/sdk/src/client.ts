import type { ErrorEvent, Platform, StackFrame } from "@mini-sentry/shared";
import { parseDsn, type ParsedDsn } from "./dsn.js";
import { parseStack } from "./stack.js";

export type { ErrorEvent, StackFrame };

export interface ClientOptions {
  dsn: string;
  release?: string;
  environment?: string;
  /** Set to false to turn the SDK off, e.g. in local development. */
  enabled?: boolean;
  /** Edit or drop (return null) an event before it is sent. */
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;
}

export type Transport = (event: ErrorEvent, dsn: ParsedDsn) => Promise<void>;

// Matches the ingestion API's limits, so oversized events are trimmed instead of rejected.
const MAX_MESSAGE = 8192;
const MAX_STACK = 65536;

export class Client {
  private readonly dsn: ParsedDsn;
  private readonly inFlight = new Set<Promise<void>>();
  // Errors already reported, so a captured-then-rethrown error is not sent twice.
  private readonly seen = new WeakSet<object>();

  constructor(
    private readonly options: ClientOptions,
    private readonly platform: Platform,
    private readonly transport: Transport,
    private readonly context: () => Partial<ErrorEvent> = () => ({}),
  ) {
    this.dsn = parseDsn(options.dsn);
  }

  /** Reports an error. Returns the event id, or undefined if nothing was sent. */
  captureException(error: unknown, extraFrames?: StackFrame[]): string | undefined {
    if (this.options.enabled === false) return undefined;
    if (typeof error === "object" && error !== null) {
      if (this.seen.has(error)) return undefined;
      this.seen.add(error);
    }

    let event: ErrorEvent | null = this.buildEvent(error, extraFrames);
    if (this.options.beforeSend) {
      try {
        event = this.options.beforeSend(event);
      } catch {
        // A broken beforeSend must not take the app down; send the original event.
      }
    }
    if (!event) return undefined;

    // Transport errors are swallowed: reporting an error must never cause another one.
    const sending = this.transport(event, this.dsn).catch(() => undefined);
    this.inFlight.add(sending);
    void sending.finally(() => this.inFlight.delete(sending));
    return event.eventId;
  }

  /** Waits for queued events to be sent. Resolves false if the timeout was hit first. */
  async flush(timeoutMs = 2000): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const done = Promise.all(this.inFlight).then(() => true as const);
    try {
      return await Promise.race([done, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private buildEvent(error: unknown, extraFrames?: StackFrame[]): ErrorEvent {
    const { type, message, stack } = normalizeError(error);
    const frames = parseStack(stack);
    return {
      ...this.context(),
      eventId: uuid(),
      timestamp: new Date().toISOString(),
      platform: this.platform,
      type,
      message: truncate(message, MAX_MESSAGE),
      ...(stack ? { stack: truncate(stack, MAX_STACK) } : {}),
      frames: frames.length ? frames : (extraFrames ?? []),
      ...(this.options.release ? { release: this.options.release } : {}),
      ...(this.options.environment ? { environment: this.options.environment } : {}),
    };
  }
}

function normalizeError(error: unknown): { type: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return { type: error.name || "Error", message: error.message, stack: error.stack };
  }
  if (typeof error === "string") return { type: "Error", message: error };

  let message: string;
  try {
    message = JSON.stringify(error) ?? String(error);
  } catch {
    message = String(error);
  }
  return { type: "Error", message: `Non-Error value thrown: ${message}` };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function uuid(): string {
  const c = globalThis.crypto;
  // randomUUID only exists in secure contexts (HTTPS, localhost).
  if (typeof c?.randomUUID === "function") return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
