const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 minutes ago", "yesterday", "just now". */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" });

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en", { notation: n >= 10_000 ? "compact" : "standard" }).format(n);
}

export interface ClientInfo {
  browser: string;
  os: string;
}

/** Small user-agent parser: enough to tell the major browsers and systems apart. */
export function parseUserAgent(ua: string | null): ClientInfo {
  if (!ua) return { browser: "Unknown", os: "Unknown" };

  const node = /^Node\.js (v[\d.]+) \((\w+)\)/.exec(ua);
  if (node) {
    const platforms: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };
    return { browser: `Node.js ${node[1]}`, os: platforms[node[2]!] ?? node[2]! };
  }

  const version = (re: RegExp) => re.exec(ua)?.[1]?.split(".")[0];
  let browser = "Unknown";
  if (/Edg\//.test(ua)) browser = `Edge ${version(/Edg\/([\d.]+)/)}`;
  else if (/OPR\//.test(ua)) browser = `Opera ${version(/OPR\/([\d.]+)/)}`;
  else if (/Firefox\//.test(ua)) browser = `Firefox ${version(/Firefox\/([\d.]+)/)}`;
  else if (/Chrome\//.test(ua)) browser = `Chrome ${version(/Chrome\/([\d.]+)/)}`;
  else if (/Safari\//.test(ua) && /Version\//.test(ua))
    browser = `Safari ${version(/Version\/([\d.]+)/)}`;

  let os = "Unknown";
  if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";

  return { browser, os };
}

/** Top values with their share, e.g. [["Chrome 131", 0.8], ["Firefox 133", 0.2]]. */
export function breakdown(values: string[], limit = 3): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => [value, count / values.length]);
}
