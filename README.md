# lifecycle-cli (`lfc`)

Command-line interface for [Lifecycle](https://github.com/GoodRx/lifecycle) — view and manage preview environments (builds), redeploy services, and host static sites, straight from your terminal. Built for humans *and* agents: every command supports `--json`.

```
$ lfc builds list --mine
UUID                 STATUS    PR                        BRANCH         AUTHOR     SERVICES  UPDATED
dashing-otter-42     deployed  acme/storefront#123       feat/header    jdoe       4/4       12m ago
brave-falcon-7       building  acme/api#88               fix/timeout    jdoe       2/5       just now
```

## Installation

Requires [mise](https://mise.jdx.dev) (or Node ≥ 20 + pnpm 9 managed yourself).

```bash
git clone <this repo> && cd lifecycle-cli
mise install          # pins node 24 + pnpm 9
pnpm install
pnpm build
pnpm link --global    # puts `lfc` on your PATH
lfc --help
```

> Publishing to npm / Homebrew is a planned follow-up; for now `pnpm link --global` is the supported install.

## Authentication

If your Lifecycle deployment enforces auth (Keycloak, optionally brokered to your company IdP such as Okta):

```bash
lfc login             # opens your browser → SSO → done
lfc login --device    # headless/SSH: prints a URL + code to confirm on any device
lfc whoami            # show the logged-in user, roles, token expiry
lfc logout
```

- Uses the `lifecycle-cli` public Keycloak client with Authorization Code + PKCE (S256) on a localhost loopback redirect; `--device` uses the OAuth Device Code grant (PKCE enforced there too).
- Tokens are cached per profile at `~/.config/lifecycle-cli/tokens/` (mode 0600) and refreshed automatically; you'll only re-login when the SSO session itself expires (~12h).
- For auth-less deployments set `authEnabled=false` on the profile and skip all of this.

## Profiles

The default profile targets the production deployment. Manage profiles with:

```bash
lfc config list
lfc config get                          # active profile as JSON
lfc config set apiUrl https://app.lifecycle.example.com
lfc config add-profile local --api-url http://localhost:8080 --no-auth
lfc config use-profile local
lfc --profile local builds list         # one-off profile override
```

Config lives at `~/.config/lifecycle-cli/config.json`. Environment overrides: `LFC_PROFILE`, `LIFECYCLE_API_URL`, `LFC_JSON=1`, `LFC_CONFIG_DIR`.

## Builds (preview environments)

```bash
lfc builds list                          # paginated; excludes torn_down/pending by default
lfc builds list --mine --search checkout --all -n 50 -p 2
lfc builds get <uuid>                    # status, PR, services + links, env overrides
lfc builds get <uuid> --manifest         # include the stored manifest
lfc builds status <uuid>                 # one-shot status (exit 1 if failed)
lfc builds status <uuid> --watch         # live-updating until deployed/failed; exit 0/1/2
lfc builds redeploy <uuid> [--watch]     # redeploy everything
lfc builds destroy <uuid> [--yes]        # tear down (asks first)
lfc builds update-uuid <uuid> <new-uuid> # rename the environment
```

### Env-var overrides (the “PR comment” overrides)

```bash
lfc builds env get <uuid>
lfc builds env set <uuid> FEATURE_FLAG=on DEBUG=1     # merges into runtime overrides
lfc builds env set <uuid> --init MIGRATE=true         # init-container overrides
lfc builds env unset <uuid> DEBUG
```

## Services

```bash
lfc services list <build-uuid>                 # names, status, branch, public links
lfc services list <build-uuid> --all           # include disabled services
lfc services redeploy <build-uuid> <name>      # rebuild + redeploy just one service
lfc services enable  <build-uuid> <name>       # toggle optional services
lfc services disable <build-uuid> <name>
lfc services set-branch <build-uuid> <name> <branch-or-url>
```

## Sites (static site hosting)

Upload a ZIP, a single HTML file, or a directory (auto-zipped) and get a stable URL back:

```bash
lfc sites create ./report.html --name "perf report"
# ✓ Created site a1b2c3d4e5 (perf report)
# https://a1b2c3d4e5.sites.lfc.goodrx.com

lfc sites create ./dist                  # whole directory
lfc sites list --mine
lfc sites get a1b2c3d4e5
lfc sites update a1b2c3d4e5 ./dist       # replace content (new version)
lfc sites extend a1b2c3d4e5              # push out the TTL/expiry
lfc sites delete a1b2c3d4e5 --yes
```

## For agents / scripting

- Add `--json` to any command for clean, stable JSON on stdout (human chatter goes to stderr). `LFC_JSON=1` does the same globally.
- Non-interactive safety: destructive commands (`destroy`, `delete`) require `--yes` when stdin is not a TTY.
- Exit codes: `0` success · `1` failure/API error · `2` watch timeout · `3` not found · `4` auth error.

```bash
# Examples
lfc builds get my-env --json | jq '.deploys[] | {name: .deployable.name, url: .publicUrl}'
lfc sites create ./coverage --json | jq -r .url
lfc builds status my-env --watch && run-smoke-tests "$(lfc builds get my-env --json | jq -r '.deploys[0].publicUrl')"
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0 — same as the Lifecycle core application. See [LICENSE](LICENSE).
