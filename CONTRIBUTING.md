# Contributing to lifecycle-cli

## Dev setup

```bash
mise install          # node 24 + pnpm 9 (pinned in mise.toml)
pnpm install
pnpm dev -- builds list        # run from source via tsx (args after --)
pnpm generate:api              # regenerate src/lib/generated from Lifecycle /api/docs
pnpm test                      # vitest unit tests
pnpm typecheck
pnpm build                     # tsup → dist/index.js (single ESM file)
```

To exercise a local build as `lfc`: `pnpm build && pnpm link --global`.

## Project layout

```
src/
  index.ts            # commander program + global flags (--json, --profile, --api-url)
  lib/
    config.ts         # profiles + token storage (~/.config/lifecycle-cli)
    auth.ts           # OIDC: PKCE loopback login, device flow, refresh, logout
    api.ts            # typed client for /api/v2; envelope unwrap; 401 refresh-retry
    context.ts        # per-command context + error→exit-code mapping
    output.ts         # tables, colors, durations; honors --json and non-TTY
    zip.ts            # directory → in-memory zip (sites upload)
    generated/        # Orval-generated schemas from Lifecycle /api/docs
    types.ts          # CLI-facing API compatibility aliases over generated schemas
  commands/           # one file per command group: auth, config, builds, services, sites
tests/                # vitest unit tests
docs/plan.html        # living plan/architecture/testing document
```

## Conventions

- **v2-first**: use `/api/v2` endpoints (same as lifecycle-ui). The response envelope is
  `{ request_id, data, error, metadata }` — `ApiClient.request` unwraps it and throws `ApiError` with the request id.
- **API types**: generated schemas come from the same OpenAPI docs endpoint as lifecycle-ui. Set
  `NEXT_PUBLIC_API_URL` or `LIFECYCLE_API_URL`, then run `pnpm generate:api`. Keep CLI-specific
  nullability/backward-compatibility in `src/lib/types.ts`, not in generated files.
- **Output discipline**: data → stdout; progress/confirmation chatter → stderr; `--json` must emit _only_ JSON on stdout.
- **Interactivity**: prompts (`@clack/prompts`) only when stdin is a TTY; every prompt needs a flag escape hatch (`--yes`, `--device`, …) so agents can run non-interactively.
- **Auth**: never log tokens; token files are 0600. Anything touching the live Keycloak realm must be additive-only.
- Strict TypeScript; keep new code passing `pnpm typecheck` with `noUncheckedIndexedAccess`.

## Testing against a real deployment

Unit tests run offline. For integration testing, log in (`lfc login`) against your deployment and use read-only commands first (`builds list`, `sites list`). For write-path tests prefer disposable resources: a `lfc sites create/update/extend/delete` roundtrip is safe and covers multipart upload, TTL, and deletion.

## Releasing (manual for now)

1. Bump `version` in `package.json` and create a matching release tag (for example `v0.2.1`).
2. `pnpm build && pnpm test`.
3. Tag and push. npm publish / Homebrew tap are tracked follow-ups.
