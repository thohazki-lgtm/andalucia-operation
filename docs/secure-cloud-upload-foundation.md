# Secure cloud upload foundation

R2.4E.1 adds a dormant, server-side transport foundation for a later manager-authorized Google Drive recovery upload. It does not enable automatic uploads and is not connected to the application scheduler.

## Security boundary

- Input is an already-encrypted `.age` recovery artifact plus its matching `andalucia-offdevice-database-export-v1` sidecar.
- The uploader never encrypts, decrypts, reads a recovery identity, or requests the recovery passphrase.
- Google authorization uses a desktop Authorization Code flow with PKCE, loopback callback, CSRF state validation, and exactly `https://www.googleapis.com/auth/drive.file`.
- The approved Google permission identity and stable folder ID are explicit configuration. Folder-name lookup and Drive-root fallback are prohibited.
- OAuth credentials belong in Windows Credential Locker under an external `andalucia-cloud:*` reference. They are never stored in source, `.env`, application databases, backup folders, sidecars, browser storage, logs, or operation results.
- The supplied PowerShell helper is a static Credential Locker bridge. Requests travel through private process pipes; secret values are never command-line arguments. Automated tests use an in-memory fake and never access Credential Locker.

## Upload transaction

The coordinator validates local paths, regular-file identity, sidecar format, backup/schema/manifest bindings, byte size, and SHA-256 before authorization. It then verifies the approved Drive identity and folder ID, checks for exact idempotent pairs or conflicts, and uploads with resumable sessions under incomplete object names and metadata.

Success is recorded only after both remote objects have verified size/checksum metadata, both are finalized as one pair, and both finalized objects are read back successfully. Missing checksums, partial pairs, ambiguous duplicates, cleanup failures, identity mismatch, destination mismatch, and authorization mismatch fail closed.

## Future manager provisioning

A later separately authorized phase must provide an external desktop OAuth client ID, choose an unused loopback port, authorize the intended Google identity, select a folder made accessible to this app, record its stable Drive folder ID and identity binding, and store the resulting token material in Windows Credential Locker. No real values belong in this repository.

R2.4E.1 does not perform that provisioning, does not call a real Google account, and does not modify the Daily Verified Backup or Weekly Restore Rehearsal tasks.
