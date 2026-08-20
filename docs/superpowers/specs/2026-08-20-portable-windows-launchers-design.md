# Portable Windows Launchers Design

## Goal

Make the source-tree Windows login and serve launchers work for any Windows user without embedding a developer username, drive, Codex installation path, or Documents path.

## Scope

This change covers only:

- `start-weixin-login.cmd`
- `start-weixin-serve.cmd`
- an automated launcher contract test

It does not change Electron startup, the installed scheduled task, service environment persistence, provider settings, or the running bridge process.

## Behavior

Both launchers keep the repository-root working directory and the Chinese locale default. They no longer assign `CODEX_REAL_BIN`; the existing runtime command resolver remains responsible for finding `codex` from explicit environment configuration or `PATH`.

Environment values supplied by the caller take precedence. A launcher only supplies a default when the corresponding variable is absent:

- `CODEX_APP_SERVER_TRANSPORT` defaults to `stdio`.
- `CODEXBRIDGE_LOCALE` defaults to `zh-CN`.
- `CODEXBRIDGE_DEFAULT_CWD` defaults to `%USERPROFILE%\Documents` when that directory exists, then falls back to the repository root.

The serve launcher forwards the resolved `CODEXBRIDGE_DEFAULT_CWD` through `--cwd`. The login launcher keeps its existing 480-second timeout and does not need a `--cwd` argument.

## Testing

A focused Node test reads both committed batch files and verifies:

- no fixed `C:\Users\...` path, drive-specific Documents path, or historical `cully` username remains;
- caller-provided environment variables are guarded with `if not defined`;
- the Documents-to-repository fallback is present;
- login and serve still invoke the expected npm scripts and arguments.

The focused test must fail against the current launchers before implementation and pass after the scripts are updated. The full release verification remains the final integration gate.

## Risks

The change intentionally relies on the runtime's existing Codex command resolution. If `codex` is not installed or not on `PATH`, the runtime will continue to return its existing actionable command-not-found error instead of silently using a machine-specific path.
