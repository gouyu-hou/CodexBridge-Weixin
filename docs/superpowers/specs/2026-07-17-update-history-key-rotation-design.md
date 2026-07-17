# Update History and Trusted Key Rotation

## Goal

Make lightweight update operations auditable and allow a client to trust more
than one Ed25519 signing key during a controlled key rotation.

## Design

The existing lightweight manifest remains schema version 2 and continues to
carry one signing `keyId`. Verification accepts a trusted key ring and selects
the key whose derived SPKI SHA-256 id matches that manifest field. A key ring is
loaded from `CODEXBRIDGE_LIGHTWEIGHT_UPDATE_PUBLIC_KEYS`, the existing single-key
environment variables, or a shipped `assets/update/lightweight-public-keys.json`
file with a fallback to the existing PEM file. Existing single-key deployments
therefore continue to work without migration.

The key-ring JSON format is:

```json
{
  "schemaVersion": 1,
  "keys": [
    { "keyId": "<sha256-spki>", "publicKey": "-----BEGIN PUBLIC KEY-----..." }
  ]
}
```

The implementation derives each key id and rejects an explicitly supplied id
that does not match the key material. Duplicate ids and invalid key types are
rejected. Private keys are never accepted by the verification path.

Update history is stored at `stateDir/updates/history.json` by a small focused
store. Writes are serialized and use a temporary file plus rename. Corrupt
history is quarantined and replaced with an empty history. The store keeps the
newest bounded records and exposes only sanitized recent records to the admin
status. Each record contains an action (`verify`, `install`, `failure`, or
`rollback`), result, timestamp, stage, version information, key id, and a
bounded error category/message. It never stores private key material or user
prompts.

The Electron updater records successful and failed verification, successful and
failed installation, startup revalidation, and manual or automatic rollback.
An installation record also persists the signing key id in `.installed.json`.

## Compatibility and Failure Handling

- Legacy single PEM environment variables and the legacy shipped PEM remain
  valid inputs.
- If no trusted public key is available, remote lightweight updates remain
  disabled as before.
- A malformed key ring fails closed before any update network request.
- History write failures do not change signature or package verification
  decisions; they are surfaced in the lightweight status error field while the
  update operation retains its original result.

## Testing

- Verify a manifest signed by each key in a multi-key ring.
- Reject a key-ring id mismatch, duplicate keys, and private keys.
- Preserve legacy single-key verification.
- Persist bounded history atomically and quarantine corrupt history.
- Assert Electron source records verification, installation, failure, and
  rollback events and resolves the key ring before network access.
