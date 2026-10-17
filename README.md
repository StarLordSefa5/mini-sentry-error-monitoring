# Mini Sentry

Open-source error monitoring service. Add the SDK to your app; errors from real users are sent to the server, grouped into issues by stack-trace fingerprint, shown on a dashboard, and announced on Slack/Discord when something new breaks.

> Status: week 2 of 8. SDK captures errors in the browser and Node.js; events are stored directly (queue arrives in week 3).

## Architecture

```
Write path:  SDK ──▶ Ingestion API ──▶ Redis queue ──▶ Worker (fingerprint + group) ──▶ PostgreSQL
Read path:   Dashboard ──▶ Dashboard API ──▶ PostgreSQL
```

## Repository layout

| Path              | Purpose                                 |
| ----------------- | --------------------------------------- |
| `apps/api`        | Ingestion API and dashboard API         |
| `apps/worker`     | Processes queued events, groups issues  |
| `apps/dashboard`  | React dashboard                         |
| `packages/db`     | Prisma schema, migrations and client    |
| `packages/sdk`    | SDK published to npm                    |
| `packages/shared` | Shared types (`ErrorEvent`, `Issue`, …) |

## Getting started

Requirements: Node.js 22+, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env
pnpm infra:up      # PostgreSQL + Redis
pnpm build
pnpm db:migrate   # apply migrations
pnpm dev          # API on http://localhost:4000
```

## Scripts

| Command           | What it does               |
| ----------------- | -------------------------- |
| `pnpm dev`        | Run the API in watch mode  |
| `pnpm db:migrate` | Create/apply migrations    |
| `pnpm build`      | Build every workspace      |
| `pnpm typecheck`  | Type-check every workspace |
| `pnpm lint`       | ESLint across the repo     |
| `pnpm format`     | Prettier write             |
| `pnpm infra:up`   | Start PostgreSQL and Redis |
| `pnpm infra:down` | Stop them                  |

## Using the SDK

Create a project to get its DSN, then:

```ts
// Browser
import { init, captureException } from "@mini-sentry/sdk";
init({ dsn: "http://<key>@localhost:4000/<projectId>", release: "my-app@1.0.0" });

// Node.js
import { init } from "@mini-sentry/sdk/node";
init({ dsn: "http://<key>@localhost:4000/<projectId>" });
```

The browser SDK reports `window` errors and unhandled promise rejections. The Node SDK reports uncaught exceptions and unhandled rejections, then exits with code 1 like Node does on its own (`exitOnError: false` to opt out).

Try it locally:

```bash
pnpm example:browser                        # open http://localhost:5500/?dsn=<DSN>
node examples/node/crash.mjs "<DSN>"        # uncaught exception
node examples/node/crash.mjs "<DSN>" rejection
```

## API

| Method | Path                                      | Auth    |
| ------ | ----------------------------------------- | ------- |
| POST   | `/api/:projectId/events`                  | API key |
| POST   | `/api/auth/register`                      | —       |
| POST   | `/api/auth/login`                         | —       |
| POST   | `/api/auth/logout`                        | —       |
| GET    | `/api/auth/me`                            | session |
| GET    | `/api/projects`                           | session |
| POST   | `/api/projects`                           | session |
| GET    | `/api/projects/:projectId`                | session |
| POST   | `/api/projects/:projectId/api-key/rotate` | session |

## Design decisions

- **Fastify over Express.** The ingestion endpoint takes the most load in the system; Fastify has lower per-request overhead and built-in schema-friendly hooks.
- **Two kinds of credentials.** The SDK's API key (DSN public key) ships inside browser code, so it is treated as public: it will only be able to write events. Everything else, including project management, needs a logged-in session. Management routes ignore API keys entirely.
- **Database sessions in an HTTP-only cookie.** The cookie holds a random 256-bit token and the `Session` table stores only its SHA-256 hash, so a leaked table cannot be replayed. Logout deletes the row, which a stateless JWT could not do. `SameSite=Lax` blocks cross-site POSTs carrying the cookie.
- **scrypt for passwords.** Built into Node, so there is no native addon to compile. Parameters are stored in the hash string so they can be raised later.
- **No account enumeration.** Unknown email and wrong password return the same 401, and the unknown-email path still runs a hash comparison so timing matches.
- **404 for other users' projects**, not 403, so project ids are not confirmed to exist.
- **Shared `db` package.** The API and the worker use the same Prisma client and schema.
- **Ingestion is a separate Fastify scope.** Session cookies are only parsed for dashboard routes, so event writes never pay for a session lookup.
- **Events are sent as `text/plain` JSON with the key in the query string.** That makes the request a CORS "simple request": no preflight round trip per error, and `navigator.sendBeacon` (which cannot set headers) works. The key is public anyway.
- **Unacknowledged events are re-sent with `sendBeacon` when the page is hidden.** `fetch` can be cut off when a tab closes. A re-sent event may arrive twice; the unique `eventId` makes the second write a no-op.
- **Stack traces are parsed in the SDK** (V8 and Firefox/Safari formats) into frames, and the raw stack is kept too, so the server can re-parse later.
- **The SDK never throws.** Transport failures are swallowed and the same error object is reported once, so error reporting cannot create new errors or loops.
- **The published SDK has no private dependencies.** `tsup` inlines the shared wire types into its `.d.ts` files and ships ESM + CJS.
