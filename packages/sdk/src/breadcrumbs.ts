import type { BreadcrumbLevel } from "@mini-sentry/shared";
import type { Client } from "./client.js";

const CONSOLE_LEVELS: Record<string, BreadcrumbLevel> = {
  debug: "debug",
  log: "info",
  info: "info",
  warn: "warning",
  error: "error",
};

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
}

/** Records console output as breadcrumbs. Output still goes to the console as before. */
export function instrumentConsole(client: Client): void {
  if (typeof console === "undefined") return;
  const target = console as unknown as Record<string, (...args: unknown[]) => void>;
  for (const [method, level] of Object.entries(CONSOLE_LEVELS)) {
    const original = target[method];
    if (typeof original !== "function") continue;
    target[method] = function (this: unknown, ...args: unknown[]) {
      const message = args.map(formatArg).join(" ");
      // The SDK's own warnings are not part of the app's story.
      if (!message.startsWith("[mini-sentry]")) {
        client.addBreadcrumb({ type: "console", level, message });
      }
      return original.apply(this, args);
    };
  }
}

/** Query strings and fragments often carry tokens or personal data, so they are dropped. */
export function scrubUrl(raw: string, base?: string): string {
  try {
    const url = new URL(raw, base);
    const sameOrigin = base !== undefined && url.origin === new URL(base).origin;
    return sameOrigin ? url.pathname : `${url.origin}${url.pathname}`;
  } catch {
    return raw.split(/[?#]/)[0] ?? raw;
  }
}

const INTERACTIVE = "a,button,[role=button],input,select,textarea,label,summary,[data-testid]";

/** `button#pay.btn.primary "Pay now"` — never an input's value. */
export function describeElement(target: Element): string {
  const el = target.closest(INTERACTIVE) ?? target;
  let out = el.tagName.toLowerCase();
  if (el.id) out += `#${el.id}`;
  const classes = typeof el.className === "string" ? el.className.trim().split(/\s+/) : [];
  for (const cls of classes.filter(Boolean).slice(0, 2)) out += `.${cls}`;

  const testId = el.getAttribute("data-testid");
  if (testId) out += `[data-testid="${testId}"]`;
  const label = el.getAttribute("aria-label");
  const isField = /^(input|select|textarea)$/i.test(el.tagName);
  const text = label ?? (isField ? null : el.textContent?.trim().replace(/\s+/g, " "));
  if (text) out += ` "${text.length > 40 ? `${text.slice(0, 39)}…` : text}"`;
  return out;
}

/**
 * Browser breadcrumbs: clicks, fetch requests, route changes and console output.
 * `isOwnRequest` excludes the SDK's own event uploads.
 */
export function instrumentBrowser(client: Client, isOwnRequest: (url: string) => boolean): void {
  instrumentConsole(client);

  document.addEventListener(
    "click",
    (e) => {
      if (e.target instanceof Element) {
        client.addBreadcrumb({ type: "click", message: describeElement(e.target) });
      }
    },
    { capture: true, passive: true },
  );

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const response = nativeFetch.call(window, input, init);
      if (isOwnRequest(url)) return response;

      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const message = `${method} ${scrubUrl(url, location.href)}`;
      const started = Date.now();
      return response.then(
        (res) => {
          client.addBreadcrumb({
            type: "fetch",
            message,
            level: res.status >= 400 ? "error" : "info",
            data: { status: res.status, duration_ms: Date.now() - started },
          });
          return res;
        },
        (err: unknown) => {
          client.addBreadcrumb({
            type: "fetch",
            message,
            level: "error",
            data: { error: err instanceof Error ? err.message : String(err) },
          });
          throw err;
        },
      );
    };
  }

  let lastPath = location.pathname;
  const recordNavigation = () => {
    const to = location.pathname;
    if (to === lastPath) return;
    client.addBreadcrumb({
      type: "navigation",
      message: `${lastPath} → ${to}`,
      data: { from: lastPath, to },
    });
    lastPath = to;
  };
  // Single-page apps change the URL through the History API instead of loading a page.
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      recordNavigation();
      return result;
    };
  }
  window.addEventListener("popstate", recordNavigation);
}
