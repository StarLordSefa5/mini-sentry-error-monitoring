import { readdir, readFile, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export interface MapFile {
  /** Path of the .map file on disk. */
  path: string;
  /** URL path the minified file is served from, e.g. "/assets/index-BxK3a9Qz.js". */
  urlPath: string;
}

/** Finds every *.js.map / *.mjs.map / *.cjs.map under `dir`. */
export async function findSourceMaps(dir: string, urlPrefix = "/"): Promise<MapFile[]> {
  const prefix = urlPrefix.endsWith("/") ? urlPrefix : `${urlPrefix}/`;
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.[cm]?js\.map$/.test(e.name))
    .map((e) => {
      const path = join(e.parentPath, e.name);
      // URL paths always use "/", whatever the OS separator is.
      const rel = relative(dir, path).split(sep).join("/");
      return { path, urlPath: `${prefix}${rel.replace(/\.map$/, "")}` };
    })
    .sort((a, b) => a.urlPath.localeCompare(b.urlPath));
}

export interface UploadOptions {
  apiUrl: string;
  projectId: string;
  token: string;
  release: string;
  files: MapFile[];
  deleteAfter?: boolean;
  concurrency?: number;
  log?: (line: string) => void;
}

export interface UploadSummary {
  uploaded: number;
  failed: { file: MapFile; reason: string }[];
}

/** Uploads maps a few at a time. Never throws for a single file; failures are reported. */
export async function uploadSourceMaps(options: UploadOptions): Promise<UploadSummary> {
  const { apiUrl, projectId, token, release, files, log = () => {} } = options;
  const base = apiUrl.replace(/\/+$/, "");
  const queue = [...files];
  const summary: UploadSummary = { uploaded: 0, failed: [] };

  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      try {
        const body = await readFile(file.path, "utf8");
        const url =
          `${base}/api/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(release)}` +
          `/sourcemaps?file=${encodeURIComponent(file.urlPath)}`;
        const res = await fetch(url, {
          method: "PUT",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} ${detail}`.trim());
        }
        summary.uploaded++;
        log(`  ✓ ${file.urlPath}`);
        // Maps contain the original source code; most apps should not serve them publicly.
        if (options.deleteAfter) await rm(file.path);
      } catch (err) {
        summary.failed.push({ file, reason: (err as Error).message });
        log(`  ✗ ${file.urlPath}: ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: options.concurrency ?? 4 }, worker));
  return summary;
}

/** "https://<key>@errors.example.com/<projectId>" -> API base URL and project id. */
export function parseDsn(dsn: string): { apiUrl: string; projectId: string } {
  const url = new URL(dsn);
  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  if (!projectId) throw new Error(`Invalid DSN: ${dsn}`);
  const basePath = segments.length ? `/${segments.join("/")}` : "";
  return { apiUrl: `${url.protocol}//${url.host}${basePath}`, projectId };
}
