import { instrumentConsole } from "./breadcrumbs.js";
import {
  Client,
  type BreadcrumbInput,
  type ClientOptions,
  type ErrorEvent,
  type Transport,
} from "./client.js";

export type { BreadcrumbInput, ErrorEvent };

export interface NodeOptions extends ClientOptions {
  /**
   * After reporting an uncaught exception or unhandled rejection, print it and exit with code 1,
   * as Node does without the SDK. Default true. Set false if you exit the process yourself.
   */
  exitOnError?: boolean;
  /** How long to wait for the event to be sent before exiting. Default 2000 ms. */
  shutdownTimeoutMs?: number;
}

const fetchTransport: Transport = async (event, dsn) => {
  const response = await fetch(dsn.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  if (response.status === 429) {
    return { retryAfterSeconds: Number(response.headers.get("retry-after") ?? NaN) };
  }
  if (!response.ok) {
    console.warn(`[mini-sentry] Event rejected with HTTP ${response.status}`);
  }
};

let client: Client | undefined;

/** Starts capturing uncaught exceptions and unhandled promise rejections in Node.js. */
export function init(options: NodeOptions): void {
  if (client) {
    console.warn("[mini-sentry] init() called more than once; ignoring.");
    return;
  }
  const instance = new Client(
    { environment: process.env.NODE_ENV, ...options },
    "node",
    fetchTransport,
    () => ({ userAgent: `Node.js ${process.version} (${process.platform})` }),
  );
  client = instance;
  instrumentConsole(instance);

  const exitOnError = options.exitOnError ?? true;
  const timeout = options.shutdownTimeoutMs ?? 2000;
  let exiting = false;

  const handleFatal = (error: unknown) => {
    instance.captureException(error);
    if (!exitOnError || exiting) return;
    exiting = true;
    // Adding a listener turns off Node's default crash, so do it ourselves once the event is out.
    void instance.flush(timeout).finally(() => {
      console.error(error);
      process.exit(1);
    });
  };

  process.on("uncaughtException", handleFatal);
  process.on("unhandledRejection", handleFatal);
}

/** Reports an error you caught yourself. Returns the event id. */
export function captureException(error: unknown): string | undefined {
  return client?.captureException(error);
}

/** Records something worth knowing if an error follows, e.g. "job 42 started". */
export function addBreadcrumb(crumb: BreadcrumbInput): void {
  client?.addBreadcrumb(crumb);
}

/** Waits until queued events are sent, or the timeout passes. Call before a manual exit. */
export function flush(timeoutMs?: number): Promise<boolean> {
  return client ? client.flush(timeoutMs) : Promise.resolve(true);
}
