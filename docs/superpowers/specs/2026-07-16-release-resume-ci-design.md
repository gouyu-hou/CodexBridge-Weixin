# Release Resume and Windows CI Design

## Goal

Make the Windows release workflow restartable after a process, network, or
GitHub API failure, and make CI execute the same release gate plus packaged
application smoke checks on Windows.

## Scope

This change covers two independently testable improvements:

1. Add an explicit `--resume` mode to the existing release orchestrator.
2. Extend the existing GitHub Actions CI workflow with the full release gate,
   Windows packaging, and packaged smoke testing.

JSON persistence, model-catalog caching, latency metrics, and progress previews
already exist in the current codebase and are not changed by this work.

## CLI Contract

The existing modes remain unchanged:

```powershell
npm run release -- --version 0.1.7 --dry-run
npm run release -- --version 0.1.7 --publish
```

The new mode is explicit:

```powershell
npm run release -- --version 0.1.7 --resume
```

Exactly one of `--dry-run`, `--publish`, or `--resume` is required. Resume
requires a matching recovery state and never stages, commits, creates a Tag,
or rewrites an existing remote reference.

## Recovery State

The state file is stored under Git metadata and is never committed:

```text
.git/codexbridge-release-recovery.json
```

The versioned JSON shape is:

```json
{
  "schemaVersion": 1,
  "version": "0.1.7",
  "tag": "v0.1.7",
  "branch": "main",
  "remote": "gouyu",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "notesFile": "docs/releases/v0.1.7.md",
  "phase": "refs-pushed",
  "artifacts": [
    {
      "name": "CodexBridge-Weixin-Admin-Setup-0.1.7.exe",
      "size": 123456,
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
    },
    {
      "name": "CodexBridge-Weixin-Admin-Setup-0.1.7.exe.blockmap",
      "size": 1234,
      "sha256": "1111111111111111111111111111111111111111111111111111111111111111"
    },
    {
      "name": "latest.yml",
      "size": 321,
      "sha256": "2222222222222222222222222222222222222222222222222222222222222222"
    }
  ],
  "latestYmlSha256": "2222222222222222222222222222222222222222222222222222222222222222",
  "createdAt": "2026-07-16T00:00:00.000Z",
  "updatedAt": "2026-07-16T00:00:00.000Z"
}
```

Only repository-relative paths and public artifact metadata are recorded. No
tokens, credential output, message bodies, or local absolute paths are stored.

The allowed phases are:

- `push-pending`: local release commit and Tag exist; the atomic push outcome
  is unknown.
- `refs-pushed`: remote `main` and Tag both point to the release commit.
- `draft-created`: a matching Draft exists and asset reconciliation may resume.
- `draft-verified`: Draft body and all three asset digests have passed checks.

Successful final publication removes the state file. A failure before remote
references are accepted restores the pre-publish local commit/Tag and removes
the state file. A failure after remote references are accepted retains the
state file for `--resume`.

## Resume Flow

Resume performs these gates before any GitHub mutation:

1. Read and validate the state schema, requested version, branch, remote, and
   notes path.
2. Require a clean worktree and the recorded local release Commit and Tag.
3. Query both remote references and require them to point to the recorded
   Commit. An uncertain or partial reference state stops with a manual-repair
   error.
4. Verify local release assets against the recorded names, sizes, SHA-256
   values, and `latest.yml` digest.
5. Read the existing Release by Tag.

Draft reconciliation is conservative:

- If no Release exists, create the Draft with the existing three assets.
- If a matching Draft exists, compare its body, Tag, draft/prerelease flags,
  and every existing asset's size and digest.
- Upload only missing assets with no `--clobber` option.
- If an existing asset or body differs, stop instead of overwriting it.
- Verify the complete Draft, publish it, verify final public metadata, then
  remove the recovery state.

The state writer uses a same-directory temporary file, an atomic rename, and
owner-only permissions where supported. It follows the product JSON-store
pattern without importing TypeScript source into the directly executed Node
release script.

The normal publish flow writes `push-pending` before the atomic push and updates
the state after each remote phase. This makes an interrupted process recoverable
even when no JavaScript exception reaches the normal cleanup handler.

## Windows CI

The existing `.github/workflows/ci.yml` matrix remains cross-platform. Each job
uses `npm ci` and runs `npm run verify:release`, which includes root and package
type checks, boundary checks, tests, builds, and `git diff --check`.

The Windows job additionally runs:

```powershell
npm run weixin:electron:dist
node scripts/release/smoke_packaged.mjs
```

CI only validates local build and lifecycle behavior. It never runs
`--publish`, pushes Git references, creates a GitHub Release, or exposes build
artifacts publicly. The job timeout is increased to accommodate Electron
packaging on a hosted Windows runner.

## Failure Handling

- `--resume` is the only supported continuation path; rerunning `--publish`
  while a recovery file exists is rejected.
- Network/API failures retain the last safe phase and do not use force-push or
  asset clobbering.
- Missing local artifacts or mismatched hashes require a manual recovery from
  the original build directory; the script must not silently rebuild and
  replace an already referenced asset.
- All errors identify the phase and safe next action without printing secrets.

## Testing

Unit and integration coverage will include:

- exact `--resume` argument parsing and invalid state rejection;
- state transitions and atomic state-file writes;
- resume preconditions for local/remote Commit and Tag parity;
- Draft creation, missing-asset upload, mismatched-asset rejection, and final
  publication ordering through injected command runners;
- process interruption recovery using a temporary Git repository;
- CI YAML assertions for `npm ci`, `verify:release`, Windows packaging, smoke,
  and absence of publication commands.

## Non-Goals

- No automatic force-push or deletion of public Tags/Releases.
- No silent asset replacement or `--clobber` upload.
- No fully unattended production publishing from GitHub Actions.
- No changes to provider/model behavior, JSON storage, or runtime response
  semantics in this sub-project.
