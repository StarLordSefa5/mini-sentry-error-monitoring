# @mini-sentry/sdk

Error monitoring SDK for the browser and Node.js. It reports uncaught errors and unhandled promise rejections to a Mini Sentry server, where they are grouped into issues.

- Parsed stack traces (Chrome, Edge, Firefox, Safari, Node.js)
- Breadcrumbs: clicks, `fetch` requests, route changes and console output before the error
- Release and environment tagging; works with uploaded source maps
- Backs off when the server rate-limits (HTTP 429)
- Never throws: reporting an error cannot cause a new one
- About 3 KB minified and gzipped (browser), no dependencies, ESM and CommonJS

## Install

```bash
npm install @mini-sentry/sdk
```

## Browser

Initialise as early as possible, e.g. at the top of `main.tsx`:

```ts
import { init, captureException, addBreadcrumb } from "@mini-sentry/sdk";

init({
  dsn: "https://<key>@errors.example.com/<projectId>",
  release: "my-app@1.4.0", // match the release you upload source maps for
  environment: "production",
});

// Errors you catch yourself:
try {
  await checkout();
} catch (err) {
  captureException(err);
}

// Extra context for the next error:
addBreadcrumb({ type: "custom", message: "Coupon applied", data: { code: "SPRING" } });
```

## Node.js

```ts
import { init } from "@mini-sentry/sdk/node";

init({ dsn: process.env.MINI_SENTRY_DSN! });
```

After reporting an uncaught exception or unhandled rejection, the process prints the error and exits with code 1, as Node does on its own. Pass `exitOnError: false` to handle that yourself, and call `await flush()` before exiting.

## Options

| Option           | Default | Description                                          |
| ---------------- | ------- | ---------------------------------------------------- |
| `dsn`            | —       | Project DSN from the dashboard (required)            |
| `release`        | —       | Version of your app, e.g. `my-app@1.4.0`             |
| `environment`    | —       | e.g. `production`, `staging` (Node: `NODE_ENV`)      |
| `enabled`        | `true`  | Set `false` to turn the SDK off, e.g. in development |
| `beforeSend`     | —       | Edit an event or return `null` to drop it            |
| `maxBreadcrumbs` | `20`    | How many breadcrumbs to keep; `0` turns them off     |
| `exitOnError`    | `true`  | Node only: exit after reporting a fatal error        |

## Privacy

Breadcrumbs never record what users type into fields, and request URLs are stored without query strings or fragments, since those often contain tokens. Use `beforeSend` to remove anything else you do not want to send.

## Source maps

Upload your build's source maps with [`@mini-sentry/cli`](https://www.npmjs.com/package/@mini-sentry/cli) and use the same `release` here, and stack traces show your original files, lines and code.

## License

MIT
