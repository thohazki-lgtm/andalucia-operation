# Andalucía source-control requirements

These instructions apply to every coding task completed in this repository.

1. Work on a development, checkpoint, or recovery branch. Never commit directly to `main`.
2. Run the task-specific focused validation and the production build before declaring the task complete.
3. After validation succeeds, run the guarded checkpoint command below unless the explicitly authorized Local UI Development Exception applies:

   ```powershell
   powershell.exe -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File deployment/windows/Publish-AndaluciaSourceCheckpoint.ps1 -Message "Describe the completed task"
   ```

4. Confirm that the command reports matching local and remote commit SHAs. If it fails, preserve the local work and local commit, report the failure clearly, and provide the printed safe retry command. Never silently skip synchronization.
5. Never force-push, delete branches, bypass review, or commit directly to production `main`.
6. Never stage canonical databases, database files, backups, credentials, environment files, ownership markers, runtime artifacts, operational records, or synced `sources/` material.
7. Database backup and migration procedures remain separate from Git source control. Do not migrate, reset, reseed, open, or alter the canonical database as part of a source checkpoint.

The guarded checkpoint command performs its own source allowlist, sensitive-path scan, critical regression suite, push, and remote-SHA verification. A pull request and successful GitHub checks are still required before merging to `main`.

## Permanent approved-task workflow

By default, use this lifecycle and report the first incomplete state truthfully:

`Code → Focused Tests → GitHub Checkpoint → PR / Approved Merge → Guarded Activation → Live SHA and Browser Verification`

- Run only the focused tests relevant to the changed behavior plus the production build.
- After validation, use the guarded checkpoint command. Create the pull request automatically.
- UI-only pull requests may be merged automatically only after GitHub checks pass, GitHub reports no conflict, the head SHA is unchanged, and the changed-file/security review contains no migration, security, deployment, scheduler, credential, environment, database, backup, WAL, marker, or runtime artifact.
- Database migrations, security-sensitive changes, production configuration, deployment scripts, scheduler changes, or any ambiguous classification require explicit manager authorization before merge or activation.
- After an approved merge, synchronize the authoritative tracked-clean `main` checkout to the verified merge SHA and run `deployment/windows/Test-AndaluciaGuardedUiActivation.ps1`.
- Automatic UI activation is permitted only when the preflight returns `READY`. Use `deployment/windows/Invoke-AndaluciaApprovedUiActivation.ps1` with the verified SHA and the applicable authorization. Never force-stop a process, delete a marker, weaken a scheduler setting, or start a second canonical owner.
- A health check is not visual proof. Report `LIVE VERIFIED` only after `/api/health` matches GitHub `main` and the changed UI is visible in the actual desktop and mobile application.
- Report only `CODE PASS`, `GITHUB SYNC`, `LIVE VERIFIED`, or the exact blocker.

## Local UI Development Exception

During explicitly authorized Phase 1 UI polishing, GitHub publication, pull-request creation, and merge may be deferred for a reviewed UI-only checkpoint.

Use this local lifecycle:

`Code → Focused Tests → Local UI Checkpoint → Exact-SHA Approval → Guarded Activation → Live SHA and Browser Verification → Deferred GitHub Review`

This exception applies only when all of the following are true:

1. The checkpoint is on a clean `codex/local-ui-*` branch and descends directly from the currently active SHA.
2. The exact checkpoint SHA, previous live SHA, complete changed-file list, file hashes, and ancestry are verified.
3. Production changes are limited to presentation-only frontend components, styles, static assets, and focused UI/browser tests.
4. Changes to backend services, API behavior, authentication, authorization, permissions, financial or entitlement calculations, migrations, deployment, schedulers, credentials, environment files, databases, backups, WAL, ownership markers, runtime artifacts, or operational records are ineligible.
5. Focused tests, TypeScript, the production build, and responsive browser validation pass before approval.
6. The manager explicitly grants `YES_I_APPROVE_EXACT_REVIEWED_UI_CHECKPOINT` for the exact SHA and reviewed paths.
7. Approval is registered only through `Approve-AndaluciaLocalUiCheckpoint.ps1`; the manifest is never edited manually.
8. `Test-AndaluciaGuardedUiActivation.ps1 -AllowApprovedLocalCheckpoint` returns `READY`, including source, backup, ownership, Schema 027, and database-health gates.
9. Only one guarded activation is performed through `Invoke-AndaluciaApprovedUiActivation.ps1`.
10. `LIVE VERIFIED` requires `/api/health` to match the approved local SHA and visible desktop/mobile confirmation on the original localhost application.

GitHub synchronization and pull-request review remain mandatory before merging the work into `main` or treating it as a final release. Any ineligible or ambiguous change must use the default GitHub workflow above.
