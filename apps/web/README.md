# CodexBridge Web Console

Next.js control console backed by the existing CodexBridge file-json runtime.
The Web console is a separate UI surface from the Weixin admin panel, but it
reads and writes the same runtime state and provider-backed sessions.

## Runtime

- Default port: `58888`
- Default host: `0.0.0.0`
- Login URL: `http://YOUR_SERVER_IP:58888/login`
- State directory: `CODEXBRIDGE_WEB_STATE_DIR` or `~/.codexbridge`

The console resolves the repository root from its own location and reads the
shared runtime data from `<state-directory>/runtime`.

## Authentication

Set both variables before starting the server:

```bash
export CODEXBRIDGE_WEB_USERNAME=admin
export CODEXBRIDGE_WEB_PASSWORD='replace-with-a-strong-password'
```

Optional settings:

```bash
export CODEXBRIDGE_WEB_SESSION_SECRET='replace-with-a-long-random-secret'
export CODEXBRIDGE_WEB_COOKIE_SECURE=1
```

`CODEXBRIDGE_WEB_COOKIE_SECURE=1` requires HTTPS at the browser-facing
reverse proxy. Put the console behind HTTPS and an access-controlled proxy for
public or shared-network exposure; do not expose the development server
directly to the internet.

## Install, Check, Build

From the repository root:

```bash
pnpm --dir apps/web install --frozen-lockfile
pnpm --dir apps/web typecheck
pnpm --dir apps/web build
```

The root helper scripts are also available:

```bash
pnpm web:dev
pnpm web:build
pnpm web:start
```

CI runs the frozen-lockfile install, typecheck, and production build on both
Ubuntu and Windows.

## Routes

- `/login`: authenticated entry point.
- `/sessions`: session and Codex thread workspace.
- `/sessions/codex/<threadId>`: message history, replies, and thread settings.
- `/automations`: automation status list.
- `/runtime`: runtime and provider status.
- `/api/codex-threads`: Codex thread list and creation-related APIs.
- `/api/codex-threads/<threadId>/reply`: start a reply run.
- `/api/codex-threads/<threadId>/runs/<runId>/events`: live run events.

## Current Surface

- Authenticated login and logout with an HTTP-only session cookie.
- Session browser with folders, pinned/archived state, aliases, and current
  thread navigation.
- New Codex thread creation with workspace, model, reasoning effort, and
  permissions settings.
- Thread history with incremental loading and a virtualized message view.
- User replies with queued/running/completed state and live event updates for
  the current run.
- Thread model, reasoning effort, and permission settings.
- Automation list and runtime/provider status views.
- JSON APIs for sessions, Codex threads, messages, replies, run events,
  settings, model options, folders, automations, and runtime status.

The Web console shares the core runtime data but does not replace the Weixin
platform adapter or the Electron admin process. It is not a public multi-tenant
service and should be deployed with the same state-directory ownership and
backup practices as the rest of CodexBridge.
