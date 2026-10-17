# @mini-sentry/cli

Command-line tool for Mini Sentry. Uploads your build's source maps, so errors from minified production code show the original file, line, function and code in the dashboard.

## Usage

Create an upload token in the project's settings and store it as a CI secret. Then, after your build:

```bash
MINI_SENTRY_UPLOAD_TOKEN=mss_… npx @mini-sentry/cli sourcemaps upload dist \
  --release my-app@1.4.0 \
  --dsn "https://<key>@errors.example.com/<projectId>" \
  --delete-after
```

| Option                | Description                                                           |
| --------------------- | --------------------------------------------------------------------- |
| `<dir>`               | Build output folder; every `*.js.map` inside it is uploaded           |
| `--release <release>` | Must match the `release` passed to the SDK's `init()` (required)      |
| `--dsn <dsn>`         | Project DSN, or set `MINI_SENTRY_DSN`                                 |
| `--url-prefix <path>` | URL path the folder is served from (default `/`)                      |
| `--delete-after`      | Delete the maps after upload, so your original source is not deployed |

`dist/assets/index-BxK3a9Qz.js.map` is matched to the file served at `/assets/index-BxK3a9Qz.js`. If your app is served from a sub-path, set `--url-prefix`, e.g. `--url-prefix /app/`.

The upload token is secret, unlike the DSN: never put it in your app's code. The command exits with code 1 if any upload fails.

## Vite example

```ts
// vite.config.ts
export default defineConfig({ build: { sourcemap: true } });
```

```bash
vite build && npx @mini-sentry/cli sourcemaps upload dist --release "$GIT_SHA" --delete-after
```

## License

MIT
