import { Command } from 'commander';

/**
 * Agent-facing instructions, llms.txt style. Printed verbatim (no colors) so the
 * output is safe to pipe, embed in prompts, or read non-interactively.
 * Kept free of deployment-specific URLs — the CLI ships vendor-neutral.
 */
export const LLMS_INSTRUCTIONS = `# lfc — Lifecycle CLI: instructions for AI agents

You are reading the output of "lfc llms". This document contains everything an AI
agent (or script) needs to operate the Lifecycle CLI on a user's behalf: setup,
authentication, the command surface, recipes, and how to help a user who is stuck.

For information about the Lifecycle platform itself (concepts, architecture, the
lifecycle.yaml configuration reference), fetch the advanced reference:
https://uselifecycle.com/llms.txt

## What this CLI does

Lifecycle creates an isolated, full-stack preview environment (a "build") for a
pull request. Each build deploys the services defined in the repo's lifecycle.yaml
and gets public URLs. The lfc CLI lets you:

- list and inspect builds, redeploy or destroy them, watch deploy status
- set per-build environment-variable overrides (the "PR comment" overrides)
- enable/disable individual services, change their branch, redeploy just one
- inspect pods, stream runtime logs, and read build/deploy job logs
- validate a lifecycle.yaml locally with per-field errors (offline)
- host static sites (HTML reports, coverage, docs) and get a stable URL back

## Golden rules for agents

1. Add --json to every command. JSON goes to stdout; human-oriented messages go to
   stderr. Setting the environment variable LFC_JSON=1 enables it globally.
2. Never rely on interactive prompts. Prompts and pickers only appear on a TTY;
   without one, commands fail fast and name the missing flag or argument. Always
   pass things explicitly (build uuid, service name, pod name, --yes).
3. Check exit codes:
   0 = success
   1 = failure (API error, failed build, invalid schema)
   2 = watch timeout (--watch did not converge in time)
   3 = not found (unknown uuid, no config file)
   4 = authentication error (not logged in, expired session)
4. On exit code 4, run "lfc login" (or "lfc login --device" when there is no
   browser), then retry once. If it still fails, surface the error to the user.
5. Destructive commands (builds destroy, sites delete) require --yes when stdin is
   not a TTY. Confirm with the user before tearing anything down.
6. "lfc <command> --help" works on every command and subcommand and lists all flags.

## First-time setup (no config yet)

The CLI ships with no deployment URLs. The error
"No configuration found. Run \`lfc init\` to point the CLI at your Lifecycle
deployment." means it is unconfigured. To fix:

    lfc init                                  # interactive (TTY only)
    lfc init --api-url <url> --issuer <url>   # non-interactive, SSO deployment
    lfc init --api-url <url> --no-auth        # non-interactive, auth-less deployment

Useful init flags: --ui-url <url> (enables "lfc builds open"), --no-login (skip
the SSO login step), --device (device-code login for headless machines),
--name <profile> and --force (overwrite an existing profile).

Do NOT guess deployment URLs. Ask the user for their organization's Lifecycle app
URL (and Keycloak issuer URL if SSO is enforced), or for their team's onboarding
setup script.

One-off use without any saved config (auth-less deployments only):

    lfc --api-url http://localhost:8080 builds list

Configuration lives at ~/.config/lifecycle-cli/config.json and supports multiple
profiles (one per deployment):

    lfc config list
    lfc config get                       # active profile as JSON (no secrets)
    lfc config add-profile <name> --api-url <url> [--issuer <url> | --no-auth]
    lfc config use-profile <name>
    lfc --profile <name> builds list     # one-off profile override

Environment overrides: LFC_PROFILE (profile name), LIFECYCLE_API_URL (API base
URL), LFC_JSON=1 (global JSON output), LFC_CONFIG_DIR (config location).

## Authentication

Deployments with SSO use Keycloak (Authorization Code + PKCE, or device code):

    lfc login              # opens a browser for SSO
    lfc login --device     # headless: prints a verification URL and a short code
    lfc whoami             # logged-in user, roles, token expiry — best first diagnostic
    lfc logout

For --device (and "lfc init --device"), relay the printed URL and code to the user
verbatim and wait — the command blocks until they approve on another device.

Tokens are cached per profile under ~/.config/lifecycle-cli/tokens/ and refresh
automatically. A login is only needed again when the SSO session itself expires
(typically ~12h). Auth-less deployments (authEnabled=false) skip all of this.

## Command reference

Builds (preview environments):

    lfc builds list [--mine] [--search <text>] [--all] [-n <limit>] [-p <page>]
    lfc builds get <uuid> [--manifest]
    lfc builds status <uuid> [--watch]        # exit 0 deployed, 1 failed, 2 timeout
    lfc builds redeploy <uuid> [--watch]
    lfc builds destroy <uuid> --yes
    lfc builds update-uuid <uuid> <new-uuid>
    lfc builds set <uuid> --static|--no-static --track-defaults|--no-track-defaults
    lfc builds webhooks <uuid> [--invoke]
    lfc builds open <uuid> [--print]          # --print to get the UI URL without opening

Env-var overrides per build:

    lfc builds env get <uuid>
    lfc builds env set <uuid> KEY=VALUE [KEY=VALUE ...] [--init]
    lfc builds env unset <uuid> KEY [KEY ...]

Services within a build:

    lfc services list <build-uuid> [--all]
    lfc services redeploy <build-uuid> <service>
    lfc services enable|disable <build-uuid> <service>
    lfc services set-branch <build-uuid> <service> <branch>
    lfc services history <build-uuid> <service>          # build/deploy job history
    lfc services logs <build-uuid> <service> [--deploy] [--job <name>] [-f]

    Note: "lfc services edit" is an interactive TTY editor — as an agent, use
    enable/disable/set-branch instead.

Pods and runtime logs:

    lfc pods list <build-uuid> [--service <name>]
    lfc pods logs <build-uuid> <pod-name> [-c <container>] [-f] [--tail <n>] [--timestamps]

    Always pass the pod name (from "pods list"); the pod picker is TTY-only.

Schema validation (offline, no auth needed):

    lfc schema validate [path]                  # finds lifecycle.yaml / .lifecycle.yaml
    lfc schema validate --repo org/repo --branch <branch>   # server-side check

    Exit 0 valid, 1 invalid (per-field errors printed), 3 no config file found.
    --json emits {valid, file, errors: [{path, message}]}.

Static sites:

    lfc sites create <file-or-dir> [--name <label>]   # returns a stable URL
    lfc sites list [--mine]
    lfc sites get <id>
    lfc sites update <id> <file-or-dir>
    lfc sites extend <id>                              # push out the expiry
    lfc sites delete <id> --yes

## Recipes for common agent tasks

Find the build for a PR or branch:

    lfc builds list --search <branch-or-pr-text> --json
    # match on .branchName / .pullRequest fields; uuid is the key for everything else

Get the public URLs of a build's services:

    lfc builds get <uuid> --json | jq '.deploys[] | {name: .deployable.name, url: .publicUrl}'

Redeploy and wait for convergence:

    lfc builds redeploy <uuid> && lfc builds status <uuid> --watch
    # exit 0 = deployed, 1 = failed, 2 = timed out

Debug a failing or crash-looping service:

    lfc pods list <uuid> --json                    # find not-ready pods, restart counts
    lfc pods logs <uuid> <pod-name> --tail 200     # runtime logs
    lfc services history <uuid> <service> --json   # did the image build succeed?
    lfc services logs <uuid> <service>             # build-job logs (compile errors etc.)

Validate a lifecycle.yaml before pushing (guardrail):

    lfc schema validate --json    # in the repo checkout; exit code gates the push

Publish a report or artifact for humans:

    lfc sites create ./coverage --name "coverage report" --json | jq -r .url

## Troubleshooting a stuck user

- "No configuration found" -> the CLI is unconfigured; run lfc init (ask the user
  for their org's URLs or onboarding script — never guess them).
- Exit code 4, 401s, "token expired" -> lfc login (or lfc login --device on
  headless machines); verify with lfc whoami.
- Network errors / cannot reach the API -> wrong URL or the user is off VPN.
  Check the configured URL with lfc config get; ask the user to check VPN.
- Exit code 3 on a build command -> wrong or stale uuid; find the right one with
  lfc builds list --search <text>.
- Watch exited 2 (timeout) -> the deploy did not converge; investigate with
  pods list / services logs instead of blindly re-running redeploy.
- Build stuck in "building" -> a service's image build is likely failing;
  lfc services history and lfc services logs show the failing job.
- A command appears to hang in a script -> it is probably waiting on a TTY
  prompt; re-run with explicit arguments/flags (--yes, pod name, etc.).
- When escalating to maintainers, include: the exact command, exit code, stderr
  output, lfc --version, and lfc config get (it prints no secrets).

## More information

- Lifecycle platform reference (concepts, lifecycle.yaml spec): https://uselifecycle.com/llms.txt
- CLI source and issues: https://github.com/GoodRxOSS/lifecycle-cli
- Every command supports --help.
`;

export function registerLlmsCommand(program: Command): void {
  program
    .command('llms')
    .alias('instructions')
    .description('print detailed usage instructions for AI agents (llms.txt style)')
    .action(() => {
      process.stdout.write(LLMS_INSTRUCTIONS);
    });
}
