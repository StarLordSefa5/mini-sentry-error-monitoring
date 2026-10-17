# Mini Sentry

Open-source error monitoring service. Add the SDK to your app; errors from real users are sent to the server, grouped into issues by stack-trace fingerprint, shown on a dashboard, and announced on Slack/Discord when something new breaks.

> Status: week 1 of 8. Accounts, sessions and projects with API keys.

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

## API

| Method | Path                                      | Auth    |
| ------ | ----------------------------------------- | ------- |
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
