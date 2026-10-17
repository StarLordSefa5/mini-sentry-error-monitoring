# Changesets

Each file here describes a change to a published package (`@mini-sentry/sdk`, `@mini-sentry/cli`)
and how big it is (patch, minor, major).

1. `pnpm changeset` after a change that users of the SDK or CLI will notice.
2. `pnpm version-packages` bumps versions and writes the changelogs.
3. `pnpm release` builds and publishes to npm (needs `npm login`).
