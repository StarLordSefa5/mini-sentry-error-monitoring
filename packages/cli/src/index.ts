#!/usr/bin/env node
import { parseArgs } from "node:util";
import { findSourceMaps, parseDsn, uploadSourceMaps } from "./upload.js";

const HELP = `Usage: mini-sentry sourcemaps upload <dir> --release <release> [options]

Uploads the source maps in <dir> so errors from minified code show the original
file, line and function.

Options:
  --release <release>   Must match the release passed to the SDK's init() (required)
  --dsn <dsn>           Project DSN (or MINI_SENTRY_DSN)
  --url-prefix <path>   URL path <dir> is served from (default "/")
  --delete-after        Delete the .map files after upload, so they are not deployed
  -h, --help            Show this help

The upload token is read from MINI_SENTRY_UPLOAD_TOKEN. Create it in the project's
settings. Keep it secret: unlike the DSN, it must not be shipped in your app.

Example:
  MINI_SENTRY_UPLOAD_TOKEN=mss_… mini-sentry sourcemaps upload dist \\
    --release shop@1.4.0 --dsn https://<key>@errors.example.com/<projectId>
`;

function fail(message: string): never {
  console.error(`error: ${message}\n\n${HELP}`);
  process.exit(2);
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      release: { type: "string" },
      dsn: { type: "string" },
      "url-prefix": { type: "string", default: "/" },
      "delete-after": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return 0;
  }
  const [group, command, dir] = positionals;
  if (group !== "sourcemaps" || command !== "upload")
    fail(`unknown command "${positionals.join(" ")}"`);
  if (!dir) fail("missing <dir>");
  if (!values.release) fail("--release is required");

  const dsn = values.dsn ?? process.env.MINI_SENTRY_DSN;
  if (!dsn) fail("--dsn or MINI_SENTRY_DSN is required");
  const token = process.env.MINI_SENTRY_UPLOAD_TOKEN;
  if (!token) fail("MINI_SENTRY_UPLOAD_TOKEN is not set");

  const { apiUrl, projectId } = parseDsn(dsn);
  const files = await findSourceMaps(dir, values["url-prefix"]);
  if (files.length === 0) {
    console.error(`No source maps found in ${dir}. Is sourcemap output enabled in your build?`);
    return 1;
  }

  console.log(`Uploading ${files.length} source map(s) for ${values.release}…`);
  const summary = await uploadSourceMaps({
    apiUrl,
    projectId,
    token,
    release: values.release,
    files,
    deleteAfter: values["delete-after"],
    log: (line) => console.log(line),
  });
  console.log(`Done: ${summary.uploaded} uploaded, ${summary.failed.length} failed.`);
  return summary.failed.length ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`error: ${(err as Error).message}`);
    process.exit(1);
  },
);
