# Lightweight Update Security Design

## Goal

Make the optional lightweight updater safe by default. A packaged application
must not download or activate executable TypeScript from a Release unless the
archive comes from an approved HTTPS host and every package file is covered by
an Ed25519-signed manifest.

The standard NSIS/electron-updater path remains unchanged and is the fallback
whenever lightweight-update trust is not configured.

## Security Decisions

- Remote lightweight updates are disabled when no trusted public key is
  configured.
- Existing unsigned `codexbridge-lightweight-update` manifests are rejected.
- The signing private key is read only from
  `CODEXBRIDGE_LIGHTWEIGHT_SIGNING_PRIVATE_KEY_FILE`; it is never copied into
  the repository or package.
- The verification public key is read from
  `CODEXBRIDGE_LIGHTWEIGHT_UPDATE_PUBLIC_KEY`,
  `CODEXBRIDGE_LIGHTWEIGHT_UPDATE_PUBLIC_KEY_FILE`, or the shipped
  `assets/update/lightweight-public-key.pem`, in that order.
- Download URLs and every redirect must use HTTPS and a fixed GitHub host
  allowlist.
- Downloads, archive entry counts, individual files, and total extracted bytes
  have fixed limits.
- Archive paths must be repository-style relative paths with no drive prefix,
  absolute prefix, NUL, or `..` segment.
- Package verification rejects missing, changed, duplicate, unexpected, or
  symbolic-link files before activation.

## Signed Manifest

`codexbridge-lightweight.json` moves to schema version 2:

```json
{
  "schemaVersion": 2,
  "kind": "codexbridge-lightweight-update",
  "version": "0.1.7",
  "builtAt": "2026-07-16T00:00:00.000Z",
  "baseAppVersion": "0.1.7",
  "entry": "src/cli.ts",
  "requires": { "node": ">=24" },
  "files": [
    {
      "path": "src/cli.ts",
      "size": 1234,
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
    }
  ],
  "signature": {
    "algorithm": "ed25519",
    "keyId": "sha256-of-public-spki",
    "value": "base64-signature"
  }
}
```

The signature payload is deterministic JSON containing every field except
`signature`, with files sorted by normalized path. `keyId` is the lowercase
SHA-256 digest of the DER-encoded public SPKI key.

`baseAppVersion` is an exact compatibility boundary. A remote package version
must match the selected Release asset, must be newer than the current effective
version, and must target the installed built-in application version. Installed
overlays are rejected after a full-installer upgrade changes that base version.

## Components

### Pure security module

`scripts/electron/lightweight-update-security.cjs` owns:

- safe relative-path and archive-entry validation;
- package file collection and SHA-256 calculation;
- deterministic manifest payload construction;
- Ed25519 signing and verification;
- complete package-tree verification;
- trusted update URL validation;
- fixed update size/count constants.

It imports only Node standard-library modules and can be tested without
Electron.

### Package builder

`build-lightweight-update.cjs` keeps its current copy/zip responsibilities but
must fail before creating a publishable archive when the signing-key variable
is missing. It writes the schema-v2 manifest returned by the security module.

### Electron updater

`weixin-admin-main.cjs` resolves the trusted public key once per validation,
refuses remote checks when trust is absent, validates the Release asset URL,
applies a 64 MiB download limit, validates ZIP entries before extraction, and
verifies the extracted package before activation. Installed-only metadata
(`.installed.json` and the `node_modules` junction) is allowed only while
validating an already activated package.

## Failure Behaviour

- Missing public key: do not call GitHub; show that lightweight updates are not
  configured and direct the user to the full installer.
- Missing private key during build: exit non-zero without producing a new ZIP.
- Legacy/invalid signature or digest mismatch: keep the current package, remove
  staging data, and show a sanitized verification error.
- Untrusted redirect, oversized response, or unsafe archive entry: abort before
  extraction/activation.
- Activation failure after the verified package is copied: preserve the existing
  rollback behaviour.

No failure logs private-key contents, public-key contents, downloaded source,
or local private-key paths.

## Verification

- Unit tests generate ephemeral Ed25519 keys and cover valid, tampered,
  unsigned, extra-file, unsafe-path, and untrusted-URL cases.
- Source integration tests prove the Electron entrypoint invokes trust, archive,
  size, and package verification.
- JavaScript type checking, Node syntax checks, focused tests, the full release
  gate, Windows packaging, and packaged smoke remain required.

## Non-Goals

- Do not automate private-key provisioning or commit a private key.
- Do not add unattended GitHub Actions publication.
- Do not change the normal NSIS update protocol in this workstream.
- Authenticode certificate provisioning remains a separate release-operations
  task because it requires an external certificate and secret storage.
