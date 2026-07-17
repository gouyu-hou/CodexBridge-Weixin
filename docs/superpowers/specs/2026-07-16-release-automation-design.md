# Release Automation Design

## Goal

Provide one guarded Node.js command that can validate and package a release in
dry-run mode or complete the fixed GitHub release workflow in publish mode.

## User Interface

The command accepts an exact semantic version and an optional UTF-8 Markdown
release-notes path. Exactly one mode is required:

```powershell
npm run release -- --version 0.1.7 --dry-run
npm run release -- --version 0.1.7 --publish
```

The default notes path is `docs/releases/v<version>.md`. `--notes-file` can
override it. `--help` performs no repository checks or mutations.

## Safety Model

Both modes require branch `main`, remote `gouyu`, no merge conflicts, no local
or remote target tag, valid non-ignored release notes, and a safe changed-file set. The
audit rejects service env files, user state, dependencies, generated releases,
logs, binary artifacts, private keys, high-confidence provider tokens, and
machine-specific user paths. Release-note content receives the same direct
sensitive-content scan even when it is not yet tracked.

Dry-run may update `package.json` and `package-lock.json` to the requested
version. It then runs the complete release gate, creates the NSIS distribution,
checks the three update artifacts, and runs the packaged app against an
isolated temporary state directory. It never stages, commits, tags, pushes, or
calls GitHub release mutation APIs.

Publish performs the same checks and only then stages and re-audits content,
validates GitHub authentication, repository write permission, and Release
conflicts before local mutation, creates `release: v<version>` and the matching
tag, then pushes `main` and the tag atomically only to `gouyu` with per-command
proxy overrides. It uploads every asset to a Draft GitHub Release and verifies
the remote notes, asset metadata/digests, and downloaded `latest.yml` before
publishing the Draft. A pre-push failure restores source changes while removing
only the commit and tag created by the run. A post-push failure records its stage
under `.git` for manual recovery and never rewrites public commits or tags.

## Encoding

Release notes are read as UTF-8 and rejected when they contain a replacement
character or obvious question-mark corruption. The exact file path is passed
to `gh release create --notes-file`; notes are never piped through Windows
PowerShell. The Draft body is normalized for line endings and compared with the
local UTF-8 text before publication. GitHub credentials are inherited from `GH_TOKEN`/`GITHUB_TOKEN` or
resolved transiently through the Git credential helper and are never logged or
written to disk.

## Packaged Smoke Test

The smoke runner starts the unpacked packaged executable with `--smoke-test`, a
temporary state directory, a random loopback admin port, native API disabled,
and placeholder local-only provider configuration. It observes HTTP 200 from
`/api/state` and the admin HTML page, then requires the application to stop its
endpoint and child processes by itself. Temporary data is removed only after
its resolved path is confirmed to remain under the operating-system temp root.

## Verification

The script compares package and lockfile versions, artifact names and sizes,
`latest.yml` metadata, local SHA-256/SHA-512 values, remote branch/tag commits,
GitHub Draft body and asset count/state/size/digests, and a downloaded remote
`latest.yml`. The final check confirms that the same body is public and not a
prerelease. Draft verification also requires a clean local worktree.

## Non-Goals

- No automatic changelog generation from commit messages.
- No force-push, tag replacement, or release overwrite.
- No publishing to `origin`.
- No live WeChat or provider call in the packaged smoke test.
- No automatic rollback after a commit or tag has reached GitHub.
