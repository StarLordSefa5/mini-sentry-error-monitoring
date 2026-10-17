// Empty in development: Vite proxies /api to the API, so requests are same-origin.
const BASE_URL = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** Human-readable reason from the server, when it sends one. */
    readonly detail?: string,
  ) {
    super(`${status} ${code}`);
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    // The session lives in an HTTP-only cookie.
    credentials: "include",
  });
  if (res.status === 204) return undefined as T;

  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? "request_failed", data.message);
  return data as T;
}
