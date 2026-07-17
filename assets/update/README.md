# Lightweight Update Trust

`lightweight-public-key.pem` is the optional Ed25519 public key used to verify
CodexBridge lightweight update packages. A release build may ship that public
key here. When the file is absent, remote lightweight updates remain disabled
and users must use the full installer.

Only the public key belongs in this directory. Keep the private signing key
outside the repository and provide its file path at build time through
`CODEXBRIDGE_LIGHTWEIGHT_SIGNING_PRIVATE_KEY_FILE`.

Set `CODEXBRIDGE_LIGHTWEIGHT_BASE_APP_VERSION` to the exact installed app
version that the lightweight package is compatible with. The builder defaults
it to the package version. Do not target an older base when dependencies have
changed.

Public-key lookup order:

1. `CODEXBRIDGE_LIGHTWEIGHT_UPDATE_PUBLIC_KEYS` (JSON key ring or one PEM)
2. `CODEXBRIDGE_LIGHTWEIGHT_UPDATE_PUBLIC_KEY` (legacy one-key PEM)
3. `CODEXBRIDGE_LIGHTWEIGHT_UPDATE_PUBLIC_KEY_FILE` (PEM or JSON key ring)
4. `assets/update/lightweight-public-keys.json`
5. `assets/update/lightweight-public-key.pem` (legacy fallback)

The key-ring format is:

```json
{
  "schemaVersion": 1,
  "keys": [
    { "keyId": "<sha256-spki>", "publicKey": "-----BEGIN PUBLIC KEY-----..." }
  ]
}
```

During rotation, add the new public key to the key ring and ship it in the
full installer first. Publish lightweight packages signed by the matching new
private key only after that installer is available. Keep the old public key in
the ring until all packages signed by it are outside the supported rollback
window, then remove it in a later full-installer release.

The client records sanitized verification, installation, failure, and rollback
events at `stateDir/updates/history.json`. The history is bounded, written
atomically, and quarantines corrupt JSON instead of blocking startup.

See `docs/RELEASE_PROCESS.md` for key generation, package creation, rotation,
and release instructions.
