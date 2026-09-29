# ANDALUCÍA database protection

The operational PGlite store is a complete PostgreSQL directory. Treat it as one indivisible unit.

## Normal start

`npm run dev` is development-only. It selects the physically separate `.data-development/postgres` store with role `development`; it never falls back to `.data/postgres`. If that store has not been explicitly initialized, startup fails closed. `npm run db:development:init` creates an empty development store from the reviewed schema/migration/reference sources and copies zero live operational rows. An Owner account, when required for local development, must then be created through the explicit environment-driven bootstrap command; credentials are never stored in source.

The canonical store can be started only by `deployment/windows/Start-AndaluciaGuardedApplication.ps1`. That launcher validates the canonical identity, sets the non-secret guarded-start authorization marker, and invokes `npm run dev:canonical`. Running `npm run dev:canonical` without the injected absolute canonical path, canonical role, and guarded authorization fails closed. Automated tests and rehearsals must provide explicit disposable paths and their matching `test`, `rehearsal`, `backup_verification`, or `recovery_staging` identities. A non-canonical role is rejected for the canonical path, and canonical role is rejected everywhere except the canonical path. Repository construction receives an already-opened database and cannot select or default a persistent path.

## Safe stop

Stop the normal development command with one Ctrl+C and wait for both messages:

```text
Database-safe shutdown started (SIGINT).
Database-safe shutdown completed.
```

The API first stops accepting connections, waits for active HTTP work, and closes PGlite. Do not use Task Manager or force-kill for a normal stop.

## Create a verified backup

1. Stop the application safely and confirm ports 3001, 5173 and 5174 are clear.
2. Set the absolute canonical `ANDALUCIA_DATA_DIR`.
3. Set `ANDALUCIA_CONFIRM_LIVE_STORE_EXCLUSIVE=YES_I_CONFIRM_ANDALUCIA_APP_IS_STOPPED` for this command only.
4. Run `npm run db:backup -- manual`. Other prepared categories are `automatic-daily`, `automatic-weekly`, `pre-migration`, `pre-finalization`, `milestone`, `recovery`, `post-recovery-baseline`, `post-db1-protection-baseline`, and `post-stale-marker-recovery`.

A VERIFIED result requires an exact complete-directory manifest match, isolated SQL-open test, READY preflight, readable migration ledger, and operational fingerprint. An incomplete attempt is retained as invalid evidence and never replaces an earlier verified backup.

The copied original is assigned the explicit `backup` store role before validation. Application database-open gates and generic migration tooling reject that role. SQL verification and restore rehearsal operate only on separately identified disposable copies (`backup_verification` and `rehearsal`). Pinning a verified backup also applies best-effort filesystem read-only modes to its database tree; identity-aware open rejection remains the primary protection and does not rely on filesystem attributes alone.

Persistent store roles are `canonical`, `development`, `backup`, `backup_verification`, `rehearsal`, `test`, and `recovery_staging`. A backup original must never be passed to PGlite directly. If diagnostic work requires SQL access, first create an exact disposable descendant, give that descendant the appropriate non-backup role, validate its pre-open manifest, and re-hash the original after the descendant closes.

Backups and recovery evidence live under ignored `.backups/` and `.recovery/` directories. Never commit database files, WAL, manifests, credentials, or session tokens.

## Verify database health

`GET /api/health` exposes only a safe summary. An authenticated Owner with `manage_platform` may read `GET /api/database/health` for the store identity, migration level, backup status, and readiness checks. Outlet-level roles do not receive database recovery control.

Health states include `HEALTHY`, `BACKUP_RECOMMENDED`, `MIGRATION_REQUIRED`, `DATABASE_RECOVERY_REQUIRED`, `BACKUP_INVALID`, and `STORE_CONFIGURATION_ERROR`.

## DB-2 automated backup policy

DB-2 reuses the DB-1 verified-backup implementation. There is no hot-copy path. A backup is VERIFIED only after a complete offline directory copy, matching SHA-256 manifests, an isolated SQL-open test, a matching migration ledger, READY preflight, and an operational fingerprint.

The default policy is stored as filesystem administration metadata under `.backups/.db2/`:

- Daily backup at 02:00 Maldives time; retain seven verified generations.
- Weekly backup on Sunday at 02:30 Maldives time; retain eight verified generations.
- Weekly restore rehearsal on Sunday at 03:30 Maldives time; considered overdue after seven days.
- Warn when the newest verified backup is older than 24 hours.
- Milestone, pre-migration, pre-finalization, manual, recovery, and accepted recovery-baseline backups are not automatically rotated.

The application process cannot safely stop itself, copy its own database, return an HTTP response, and restart itself. Therefore the current local deployment requires Windows Task Scheduler or the future service supervisor to provide the controlled offline window:

1. Gracefully stop the application and wait for `Database-safe shutdown completed.`
2. Confirm ports 3001, 5173, and 5174 are clear.
3. Set the absolute canonical `ANDALUCIA_DATA_DIR` and the one-command exclusive-access confirmation.
4. Run `npm run db:backup:job -- daily` or `npm run db:backup:job -- weekly`.
5. Restart only with the guarded launcher if the application was running before the job.

The job refuses to run while the application ports are active. `npm run db:backup:job -- requested` processes the oldest Owner-requested manual backup during the same offline window. `npm run db:backup:job -- status` prints policy, inventory, storage, and the retention plan without copying the canonical store.

## Windows automatic execution

The deployment scripts in `deployment/windows/` install three narrowly scoped tasks for the current interactive Windows account. They store no password, application credential, session token, or API secret.

- `ANDALUCIA OPERATION - Daily Verified Backup`: daily at the accepted DB-2 policy time of 02:00 Maldives time.
- `ANDALUCIA OPERATION - Weekly Restore Rehearsal`: Sunday at 03:30 Maldives time.
- `ANDALUCIA OPERATION - Guarded Application`: an on-demand helper that restores the application's prior running state with the guarded `npm run dev` launcher.

Run `powershell -NoProfile -ExecutionPolicy Bypass -File deployment/windows/Install-AndaluciaDatabaseScheduler.ps1` to install or safely update the same named tasks. Installation is idempotent and exports non-secret task XML under `.backups/.db2/scheduler/task-exports/`. Tasks use the repository-derived absolute working directory, validate the canonical store identity, run missed schedules when next available, and reject overlapping instances.

The daily wrapper requests the API's filesystem-based scheduler shutdown handshake. The API stops accepting work, closes PGlite, records completion, and exits; the wrapper additionally requires ports 3001, 5173, and 5174 to be closed before backup. A partial runtime, failed graceful shutdown, identity mismatch, migration/recovery marker, or concurrent scheduler lock fails closed without copying. If the application was running, the guarded runtime task is started again after the job, including after a backup failure where shutdown had already completed. Restart failure returns a non-zero task result without invalidating a successfully verified backup.

Daily jobs apply the existing protected seven-generation retention only after a new backup is VERIFIED. Weekly restore rehearsals use the latest suitable verified backup, never stop or promote the canonical database, and share the same conservative scheduler lock. Locks are never automatically removed as stale; an ambiguous lock requires operator review.

Human-readable Windows job logs and machine-readable scheduler events are kept under `.backups/.db2/scheduler/logs/`. Task Scheduler receives the actual exit code. Disable without deleting history using `deployment/windows/Remove-AndaluciaDatabaseScheduler.ps1 -DisableOnly`. Remove only the task definitions using `-ConfirmRemoval`; neither action deletes backups, logs, inventory, rehearsal evidence, or canonical data.

## Retention and protection

Run `npm run db:retention:plan` to inspect a non-destructive plan. Automated removal is limited to excess verified daily and weekly generations. A candidate is never eligible when it is pinned, an accepted recovery baseline, migration or recovery evidence, the only valid category recovery point, or lacks a newer verified successor. Recovery and quarantine directories are outside retention scope.

Applying the plan is deliberately gated by `ANDALUCIA_CONFIRM_RETENTION=YES_I_APPROVE_DB2_RETENTION` and `npm run db:retention:apply`. Review the plan first. Important backups should be protected rather than removed.

## Restore rehearsal

Run `npm run db:restore:rehearse -- <backup-id>` while the canonical application is stopped or running; the command reads only the selected backup. It creates a disposable descendant, verifies the manifest, opens it with PGlite, checks migrations and preflight, compares the operational fingerprint, closes it, removes only the disposable descendant, and retains `restore-test.json` evidence beside the backup.

A failed or drifted restore test marks that backup `RESTORE_TEST_FAILED` and excludes it from preferred recovery-candidate ranking. It does not alter the original backup or canonical store. Preserve the evidence, inspect the failure in Owner Database Health, and create a new verified backup during a controlled offline window. Never promote a failed restore-test candidate automatically.

## Owner Database Health

Owners see a compact Platform section inside Customization Center. It shows database state, canonical identity, schema, latest verified backup, latest restore test, recovery readiness, warnings, backup history, storage usage, protection state, and advisory recovery candidates. Filesystem paths and secrets are not exposed in the normal UI.

The UI can request a verified manual backup, but correctly reports it as pending until the external scheduler provides an offline window. Owners may run a non-live restore rehearsal or protect a backup. Outlet Managers do not receive platform database-administration access.

Recovery readiness is separate from database health. READY requires a healthy canonical store at the supported schema 018, a verified backup within the age policy, a restore-tested backup within the rehearsal policy, and no recovery-required or migration-required condition.

## Migration source verification

Migrations 001–018 are the reviewed set. Migration 009 remains the code-backed `foundation-reference-data` migration; it is not represented by a fabricated SQL file. SQL migration checksums are byte-sensitive. The repository therefore forces `database/migrations/*.sql` to LF through `.gitattributes`, preventing Windows `core.autocrlf` from changing a legitimate migration's checkout bytes. Meaningful SQL changes, including added or removed content and whitespace other than platform line-ending conversion performed by Git, remain checksum-visible. Never replace a recorded canonical checksum to accommodate a differently materialized checkout.

## If DATABASE_RECOVERY_REQUIRED appears

Stop. Preserve the complete store and runtime markers. Do not retry in a loop, run migrations, delete `postmaster.pid`, edit `pg_control`, remove WAL, initialize an empty database, or promote a backup automatically. Begin a separately authorized copy-only recovery assessment.

## DATABASE RECOVERY REQUIRED — WHAT TO DO

1. Keep the application and scheduled database jobs stopped. Open Owner **Customization Center → Platform → Database Health** from a known-good administration runtime, or use the offline recovery CLI to inspect the incident.
2. Review only VERIFIED, SQL-open, preflight-ready, schema-018 candidates. Candidate ranking is advice, never authorization.
3. Select a candidate and review every reported operational gap against the latest known healthy fingerprint. An older but structurally valid backup may still lose business records.
4. Run a fresh restore rehearsal. Promotion remains blocked unless that exact candidate passes manifest verification, SQL open, migration-ledger checks, preflight, fingerprint reconciliation, and clean shutdown.
5. As the authenticated Owner, prepare the single-use authorization. It binds the incident, canonical identity, candidate manifest and fingerprint, rehearsal, actor, target, rollback source, and expires after 30 minutes.
6. In a controlled offline window, use `npm run db:recovery -- promote <absolute-authorization-file>` with the reviewed confirmation environment value. This quarantines the complete failed canonical directory before installing the complete staged copy; it never overlays files.
7. Start only through the guarded application launcher. Verify identity, schema 018, Owner, OutletScope, all operational modules, and the post-start fingerprint.
8. Leave the incident in **Recovery Promoted Awaiting Acceptance** until the manager has reviewed it. Then accept through Owner Database Health. Quarantine, rehearsal, authorization, and rollback evidence remain preserved.
9. If validation fails, stop the application and use `npm run db:recovery -- rollback <incident-id>` in an authorized offline window. The failed promoted store is quarantined and the complete authorized rollback backup is restored and reconciled.

Recovery is protected by an exclusive filesystem lock. While it is active, backups, restore rehearsals, migrations, Bill Tip finalization, and incentive finalization fail closed. Scheduler tasks remain registered and safely refuse concurrent work.

## Never do this

- Never manually copy individual PostgreSQL/PGlite files into the live store.
- Never run forced WAL reset or checkpoint repair against the live store.
- Never merge a damaged store with a backup.
- Never delete recovery evidence before recovery is accepted.
- Never run live migration without the single-use authorization artifact and its exact recent VERIFIED backup.
- Never perform financial finalization without a recent exact VERIFIED recovery point.
- Never delete WAL or run `pg_resetwal` to make startup succeed.
- Never delete `postmaster.pid` blindly; preserve it as incident evidence until process ownership is proven.
- Never merge database directories or restore individual PostgreSQL/PGlite files.
- Never use an unverified, failed-rehearsal, incompatible, or manifest-drifted backup.
