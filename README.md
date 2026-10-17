# Mini Sentry

Open-source error monitoring service. Add the SDK to your app; errors from real users are sent to the server, grouped into issues by stack-trace fingerprint, shown on a dashboard, and announced on Slack/Discord when something new breaks.

> Status: week 0 of 8. Repository skeleton only.

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
| `packages/sdk`    | SDK published to npm                    |
| `packages/shared` | Shared types (`ErrorEvent`, `Issue`, …) |

## Getting started

Requirements: Node.js 20+, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env
pnpm infra:up      # PostgreSQL + Redis
pnpm build
```

## Scripts

| Command           | What it does               |
| ----------------- | -------------------------- |
| `pnpm build`      | Build every workspace      |
| `pnpm typecheck`  | Type-check every workspace |
| `pnpm lint`       | ESLint across the repo     |
| `pnpm format`     | Prettier write             |
| `pnpm infra:up`   | Start PostgreSQL and Redis |
| `pnpm infra:down` | Stop them                  |

## Design decisions

Notes on why each tool was chosen will be collected here as the project grows.
