# Mini Sentry

[![CI](https://github.com/StarLordSefa5/mini-sentry-error-monitoring/actions/workflows/ci.yml/badge.svg)](https://github.com/StarLordSefa5/mini-sentry-error-monitoring/actions/workflows/ci.yml)

Open-source error monitoring service. Add the SDK to your app; errors from real users are sent to the server, grouped into issues by stack-trace fingerprint, shown on a dashboard, and announced on Slack/Discord when something new breaks.

> Status: week 7 of 8. Adds source map support and prepares the SDK and CLI for npm.

## Architecture

```
Write path:  SDK ──▶ Ingestion API ──▶ Redis queue ──▶ Worker (fingerprint + group) ──▶ PostgreSQL
Read path:   Dashboard ──▶ Dashboard API ──▶ PostgreSQL
```

## Repository layout

| Path              | Purpose                                       |
| ----------------- | --------------------------------------------- |
| `apps/api`        | Ingestion API and dashboard API               |
| `apps/worker`     | Processes queued events, groups issues        |
| `apps/dashboard`  | React dashboard                               |
| `packages/db`     | Prisma schema, migrations and client          |
| `packages/cli`    | `mini-sentry` CLI: source map upload          |
| `packages/notify` | Discord/Slack webhook formatting and delivery |
| `packages/sdk`    | SDK published to npm                          |
| `packages/shared` | Shared wire and API types                     |
| `scripts`         | Demo data seeding                             |

## Getting started

Requirements: Node.js 22+, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env
pnpm infra:up      # PostgreSQL + Redis
pnpm build
pnpm db:migrate   # apply migrations
pnpm dev          # API on http://localhost:4000
pnpm dev:worker   # in a second terminal
pnpm dev:dashboard # http://localhost:5173
pnpm seed:demo    # optional: demo account with sample errors
```

The seed script logs in as `demo@example.com` / `demo-password-123` (local development only).

## Scripts

| Command              | What it does                             |
| -------------------- | ---------------------------------------- |
| `pnpm dev`           | Run the API in watch mode                |
| `pnpm dev:worker`    | Run the worker in watch mode             |
| `pnpm dev:dashboard` | Run the dashboard (Vite)                 |
| `pnpm seed:demo`     | Create a demo account with sample errors |
| `pnpm test`          | Run all tests (needs `infra:up`)         |
| `pnpm db:migrate`    | Create/apply migrations                  |
| `pnpm build`         | Build every workspace                    |
| `pnpm typecheck`     | Type-check every workspace               |
| `pnpm lint`          | ESLint across the repo                   |
| `pnpm format`        | Prettier write                           |
| `pnpm infra:up`      | Start PostgreSQL and Redis               |
| `pnpm infra:down`    | Stop them                                |

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

The browser SDK reports `window` errors and unhandled promise rejections, with the last 20 breadcrumbs: clicks, `fetch` requests (method, path, status, duration; query strings are dropped), route changes and console output. Add your own with `addBreadcrumb({ type: "custom", message })`. The Node SDK reports uncaught exceptions and unhandled rejections, then exits with code 1 like Node does on its own (`exitOnError: false` to opt out).

Try it locally:

```bash
pnpm example:browser                        # open http://localhost:5500/?dsn=<DSN>
node examples/node/crash.mjs "<DSN>"        # uncaught exception
node examples/node/crash.mjs "<DSN>" rejection
```

## API

| Method | Path                                                                       | Auth         |
| ------ | -------------------------------------------------------------------------- | ------------ |
| POST   | `/api/:projectId/events`                                                   | API key      |
| POST   | `/api/auth/register`                                                       | —            |
| POST   | `/api/auth/login`                                                          | —            |
| POST   | `/api/auth/logout`                                                         | —            |
| GET    | `/api/auth/me`                                                             | session      |
| GET    | `/api/projects`                                                            | session      |
| POST   | `/api/projects`                                                            | session      |
| GET    | `/api/projects/:projectId`                                                 | session      |
| POST   | `/api/projects/:projectId/api-key/rotate`                                  | session      |
| GET    | `/api/projects/:projectId/issues` (`status`, `q`, `sort`, `page`, `limit`) | session      |
| GET    | `/api/projects/:projectId/issues/:issueId`                                 | session      |
| PATCH  | `/api/projects/:projectId` (`name`, `alertWebhookUrl`)                     | session      |
| POST   | `/api/projects/:projectId/alerts/test`                                     | session      |
| POST   | `/api/projects/:projectId/upload-token`                                    | session      |
| GET    | `/api/projects/:projectId/sourcemaps`                                      | session      |
| DELETE | `/api/projects/:projectId/sourcemaps/:release`                             | session      |
| PUT    | `/api/:projectId/releases/:release/sourcemaps?file=`                       | upload token |
| PATCH  | `/api/projects/:projectId/issues/:issueId` (`status`)                      | session      |
| GET    | `/api/projects/:projectId/issues/:issueId/events`                          | session      |
| GET    | `/api/projects/:projectId/issues/:issueId/stats` (`range`: `24h` or `7d`)  | session      |

## Dashboard

React + Vite + TypeScript, TanStack Query for data fetching and caching, React Router, Tailwind CSS with shadcn/ui, Recharts.

- **Projects**: create one per app; a new project opens on its setup page.
- **Issues**: unresolved / resolved / ignored / all, search over type, message and location, sort by last seen, first seen or event count. Filters live in the URL, so a filtered view can be shared. The list refreshes every 30 s.
- **Issue detail**: stack trace (library frames folded, raw stack one click away), events per hour (24h) or day (7d), latest event context, browser/OS breakdown, recent events, resolve / ignore / reopen.
- **Settings**: DSN and API key with copy buttons, SDK install snippets for browser and Node.js, a "send a test error" button, key rotation.

In development Vite proxies `/api` to the API, so the session cookie is same-origin.

## Source maps

Production code is minified, so a raw stack trace says `S at main-Z2SKI4QC.js:2:4128`. With source maps uploaded for the release, the same error shows `cartTotal in src/cart.js:8:30` and the surrounding lines of the original code.

1. Build with source maps (e.g. Vite `build.sourcemap: true`).
2. In the project's settings, create an upload token and store it as a CI secret.
3. After each build, upload the maps for the release you pass to the SDK:

```bash
MINI_SENTRY_UPLOAD_TOKEN=mss_… npx @mini-sentry/cli sourcemaps upload dist   --release my-app@1.4.0 --dsn "<DSN>" --delete-after
```

The worker rewrites each frame before grouping, so issues are grouped by original file and function names, which stay the same across deploys. Try it with `examples/minified` (`node examples/minified/build.mjs`, then open `http://localhost:5500/minified/?dsn=<DSN>`).

## Publishing the SDK and CLI

Versions and changelogs are managed with [Changesets](https://github.com/changesets/changesets):

```bash
pnpm changeset          # describe a change to @mini-sentry/sdk or @mini-sentry/cli
pnpm version-packages   # bump versions, write CHANGELOG.md
npm login
pnpm release            # build and publish to npm
```

## Alerts

Set a Discord or Slack incoming webhook in a project's settings. The worker posts a message when:

- a **new issue** appears (first event with a new fingerprint), or
- a **resolved issue happens again** (regression). The issue goes back to unresolved. Ignored issues stay ignored and silent.

Alerts run on their own BullMQ queue with retries, so a slow or failing webhook never delays grouping. A webhook that answers 404 (deleted) is not retried.

## Rate limiting

Each project may send `RATE_LIMIT_PER_MINUTE` events per minute (default 1000). Beyond that the API answers `429` with `Retry-After`, and the SDK stops sending until then. An app stuck in an error loop cannot flood the queue or the database.

## How grouping works

The worker computes a SHA-256 fingerprint from:

1. the error type (`TypeError`),
2. the message with volatile parts replaced: numbers, UUIDs, hex ids, URLs and emails become `<num>`, `<uuid>`, …,
3. the top 5 in-app frames as `file:function`. Frames from `node_modules` and `node:` internals are skipped when app frames exist. File names lose their host, query string and bundler content hash (`app-BxK3a9Qz.js` becomes `app.js`).

Line and column numbers are left out on purpose: editing an unrelated part of a file shifts every line below it, and that must not split one issue into two after a deploy. Same fingerprint, same issue. The rules are covered by unit tests in [`fingerprint.test.ts`](apps/worker/src/fingerprint.test.ts).

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
- **Ingestion answers `202 Accepted` after a Redis write.** The API validates, checks the key and enqueues (BullMQ); the worker does the database work. API latency no longer depends on Postgres load, and a traffic spike becomes a longer queue instead of failed requests. If Redis is down the API answers 503 right away instead of hanging.
- **API keys are cached in memory** (60 s, unknown keys 10 s), so ingestion does not query Postgres per event. Rotating a key evicts it on that instance; other instances accept the old key until their entry expires.
- **Retries and a dead-letter queue.** Jobs get 5 attempts with exponential backoff. A job that fails every attempt is copied to `events-dead-letter` with the failure reason, so it can be inspected and replayed instead of being lost.
- **Exactly-once counting on an at-least-once queue.** BullMQ can run a job twice (a retry, or a worker killed mid-job whose lock expires). The issue upsert and the event insert run in one transaction, and `Event.eventId` is unique: a repeat hits the unique index, the transaction rolls back, and its count increment goes with it. Tested by killing the worker mid-run: 300 sent, 300 stored, `count = 300`.
- **One SQL statement for the issue upsert.** `INSERT … ON CONFLICT DO UPDATE SET count = count + 1, lastSeen = GREATEST(…)` is atomic, so concurrent events cannot lose increments, and jobs finishing out of order cannot move `lastSeen` backwards.
- **First/last seen use server receive time**, not the client's `timestamp`, so a device with a wrong clock cannot distort an issue's timeline. The client time is still stored on the event.
- **Issue location (`culprit`) is stored once**, from the top in-app frame of the first event, so the issue list does not need to read events.
- **Event counts per hour/day are computed in SQL** with `generate_series`, so empty buckets come back as zeros and the chart's time axis has no gaps.
- **The issue detail page is lazy-loaded.** The chart library is the largest dependency, so it is only downloaded when someone opens an issue.
- **Webhook URLs are restricted to Discord and Slack (https).** A free-form URL would let any user make the worker send requests into our own network (SSRF), e.g. to Redis or a cloud metadata endpoint. Redirects are not followed for the same reason. `WEBHOOK_ALLOW_ANY_HOST=true` relaxes this for local testing only.
- **Regressions are detected under a row lock.** The worker reads the issue's status with `SELECT … FOR UPDATE` in the same transaction as the upsert, so two simultaneous events for a resolved issue produce exactly one regression alert.
- **Rate limits are a Redis fixed window** (`INCR` + `EXPIRE` per project per minute), shared by every API instance. `INCR` is atomic, so concurrent requests cannot both slip under the limit. Invalid keys are rejected before counting, so they cannot use up a project's budget.
- **Breadcrumbs drop query strings and never record input values**, since both often carry tokens or personal data.
- **Known gap:** an alert is queued after the event's transaction commits. If that enqueue fails, the retried job sees the event as already stored and the alert is lost. A transactional outbox table would close this.
- **Source map uploads need a separate secret token.** The API key is public by design (it is in every visitor's browser), so it must not be able to upload maps: a forged map would make stack traces lie. Only the token's SHA-256 hash is stored, and it is shown once.
- **Frames are resolved before fingerprinting.** Minified names and bundle hashes change with every deploy; original file and function names do not. Resolving first keeps one issue per bug across releases.
- **Parsed source maps are cached in the worker** (LRU, 50 maps). Parsing a large map takes milliseconds and the WebAssembly-backed parser needs explicit cleanup, so maps are parsed once, concurrent frames share one parse, and evicted maps are destroyed. A missing map is remembered for a minute.
- **Function names come from the original source, not the map's `names`.** A map names the token at the error position (often a property such as `total`), so the worker scans the original code upwards for the enclosing function, arrow or method declaration.
- **Source maps are stored in Postgres** for simplicity. Object storage (S3) would be the next step for large apps.

## Load test

`load/ingest.js` sends events to the ingestion endpoint with [k6](https://k6.io) (50 virtual users, 30 seconds, everything on one laptop):

```bash
k6 run -e PROJECT=<projectId> -e KEY=<apiKey> load/ingest.js
```

| Metric                                          | Result                                        |
| ----------------------------------------------- | --------------------------------------------- |
| Events accepted by the API                      | ~5,700 / s, 0% errors                         |
| API response time                               | p95 13 ms                                     |
| Events processed by one worker (concurrency 10) | ~235 / s                                      |
| Events lost                                     | 0 (172,505 sent, 172,505 stored in one issue) |

The API only validates and enqueues, so it answers fast; the worker catches up from the Redis queue. To process faster, run more workers on the same queue.

Raise `RATE_LIMIT_PER_MINUTE` before running it, or the limiter rejects everything after the first 1,000 events per minute.
