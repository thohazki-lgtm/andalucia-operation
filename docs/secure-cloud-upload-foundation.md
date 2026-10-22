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

## Manager-controlled provisioning entry point

R2.4F.2 adds a dormant command-line entry point (`npm run cloud:provision -- ...`) for a later, separately authorized production ceremony. It is not called by application startup, backups, recovery, retention, or Windows Task Scheduler.

The command requires the manager to supply non-secret configuration explicitly: the desktop OAuth client ID, a Windows Credential Locker reference, the stable Drive folder ID and relationship, and the already-verified local artifact/sidecar evidence. It opens a listener only on an ephemeral `127.0.0.1` port. The terminal displays only the local authorization page; the Google authorization URL and OAuth callback values stay within the local browser/loopback flow.

After Google authorization, the command shows a masked Google identity and requires the exact phrase `APPROVE GOOGLE IDENTITY`. It verifies the stable folder ID and ownership/Shared Drive relationship, then requires `APPROVE DRIVE DESTINATION`. Only after Credential Locker readback and local evidence revalidation does it show the recovery-pair summary and require `PUBLISH VERIFIED PAIR` before invoking the existing verified-pair upload coordinator.

Token material is passed through private process pipes to Windows Credential Locker under the supplied `andalucia-cloud:*` reference. Tokens, authorization codes, PKCE verifiers, recovery identities, and recovery passphrases are not accepted as command-line arguments and are not printed. Cancellation, callback timeout, CSRF state mismatch, broad/missing scope, token exchange failure, credential read/write failure, identity/destination mismatch, local evidence drift, remote conflicts, and partial upload cleanup all fail closed.

The entry point accepts these named arguments:

- `--client-id`
- `--credential-reference` (must start with `andalucia-cloud:`)
- `--folder-id`
- `--destination-label`
- `--relationship` (`MY_DRIVE` or `SHARED_DRIVE`)
- `--drive-id` (required for `SHARED_DRIVE`)
- `--approved-root`
- `--artifact`
- `--sidecar`
- `--backup-id`
- `--schema`
- `--manifest-sha256`
- optional `--callback-timeout-seconds` (10–600; default 300)

R2.4F.2 source validation uses synthetic identities, credentials, files, callback traffic, and Drive transport only. It does not perform real Google OAuth, access Google Drive, provision a real credential, decrypt recovery material, or modify the canonical database or protected backups.

## R2.4G live provisioning checkpoint

**Status: DEFERRED — FINAL LIVE GOOGLE PICKER FOLDER-LISTING VALIDATION PENDING**

The existing R2.4G implementation and tests remain preserved. The Web OAuth and Google Web Picker flow continues to use Windows Credential Locker, the exact `https://www.googleapis.com/auth/drive.file` scope, the configured Picker project/App ID, the protected restricted API key, explicit manager destination approval, and all existing fail-closed security boundaries.

Live validation reached a correctly rendered Google Web Picker using `ViewId.FOLDERS`, folder inclusion, folder selection, and list mode with no MIME, parent, file-ID, query, ownership, or other narrowing filter. The Picker displayed an empty folder result set. Current diagnostics cannot prove whether this represents a Google-side empty result, authorization visibility behavior, or another Picker listing condition. The root cause is therefore **not yet proven**, and no speculative source correction is authorized.

Final live folder-listing validation is deferred to the final Phase 1 infrastructure and production-readiness stage. This unresolved validation does not block continued Phase 1 application development. Until that stage, do not broaden the OAuth scope, replace the existing credentials or Picker architecture, retain a new durable OAuth credential, or perform a Google Drive upload through this incomplete provisioning flow.
