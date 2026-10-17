import { Client, type ClientOptions, type ErrorEvent, type Transport } from "./client.js";

export type { ClientOptions, ErrorEvent };

// Events whose fetch has not been acknowledged yet. On page close they are re-sent with
// sendBeacon; the server dedupes by eventId, so an event that did arrive is not stored twice.
const unacknowledged = new Map<string, { endpoint: string; body: string }>();
const MAX_UNACKNOWLEDGED = 30;

// keepalive requests are capped at 64 KB by browsers.
const KEEPALIVE_LIMIT = 60 * 1024;

const fetchTransport: Transport = async (event, dsn) => {
  const body = JSON.stringify(event);
  // When full, drop the oldest (Maps keep insertion order) so the newest events keep their retry.
  if (unacknowledged.size >= MAX_UNACKNOWLEDGED) {
    const oldest = unacknowledged.keys().next().value;
    if (oldest !== undefined) unacknowledged.delete(oldest);
  }
  unacknowledged.set(event.eventId, { endpoint: dsn.endpoint, body });

  // A string body is sent as text/plain, which keeps this a CORS "simple request": no preflight.
  const response = await fetch(dsn.endpoint, {
    method: "POST",
    body,
    keepalive: body.length < KEEPALIVE_LIMIT,
  });
  // Any response means the server saw it. Only network failures are worth a retry on page close.
  unacknowledged.delete(event.eventId);
  if (!response.ok && typeof console !== "undefined") {
    console.warn(`[mini-sentry] Event rejected with HTTP ${response.status}`);
  }
};

function flushWithBeacon(): void {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
  for (const [eventId, { endpoint, body }] of unacknowledged) {
    if (navigator.sendBeacon(endpoint, body)) unacknowledged.delete(eventId);
  }
}

let client: Client | undefined;

/** Starts capturing uncaught errors and unhandled promise rejections in the browser. */
export function init(options: ClientOptions): void {
  if (client) {
    console.warn("[mini-sentry] init() called more than once; ignoring.");
    return;
  }
  const instance = new Client(options, "browser", fetchTransport, () => ({
    url: location.href,
    userAgent: navigator.userAgent,
  }));
  client = instance;

  window.addEventListener("error", (event) => {
    // Without an Error object (e.g. a cross-origin "Script error."), fall back to the location
    // the browser gives us.
    const frame = event.filename
      ? [{ filename: event.filename, lineno: event.lineno, colno: event.colno }]
      : undefined;
    instance.captureException(event.error ?? event.message, frame);
  });

  window.addEventListener("unhandledrejection", (event) => {
    instance.captureException(event.reason);
  });

  // pagehide fires more reliably than unload, including on mobile and with bfcache.
  window.addEventListener("pagehide", flushWithBeacon);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushWithBeacon();
  });
}

/** Reports an error you caught yourself. Returns the event id. */
export function captureException(error: unknown): string | undefined {
  return client?.captureException(error);
}

/** Waits until queued events are sent, or the timeout passes. */
export function flush(timeoutMs?: number): Promise<boolean> {
  return client ? client.flush(timeoutMs) : Promise.resolve(true);
}
