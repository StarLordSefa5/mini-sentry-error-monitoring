export interface ParsedDsn {
  projectId: string;
  key: string;
  /** Full ingestion URL, key included as a query parameter so sendBeacon can use it. */
  endpoint: string;
}

/** Parses `<protocol>://<key>@<host>[/<base path>]/<projectId>`. */
export function parseDsn(dsn: string): ParsedDsn {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new Error(`[mini-sentry] Invalid DSN: ${dsn}`);
  }

  const key = decodeURIComponent(url.username);
  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  if (!key || !projectId) {
    throw new Error(`[mini-sentry] Invalid DSN: ${dsn}`);
  }

  const basePath = segments.length ? `/${segments.join("/")}` : "";
  const endpoint =
    `${url.protocol}//${url.host}${basePath}/api/${encodeURIComponent(projectId)}/events` +
    `?key=${encodeURIComponent(key)}`;
  return { projectId, key, endpoint };
}
