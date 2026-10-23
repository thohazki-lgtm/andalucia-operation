# Andalucía source-control requirements

These instructions apply to every coding task completed in this repository.

1. Work on a development, checkpoint, or recovery branch. Never commit directly to `main`.
2. Run the task-specific focused validation and the production build before declaring the task complete.
3. After validation succeeds, run:

   ```powershell
   powershell.exe -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File deployment/windows/Publish-AndaluciaSourceCheckpoint.ps1 -Message "Describe the completed task"
   ```

4. Confirm that the command reports matching local and remote commit SHAs. If it fails, preserve the local work and local commit, report the failure clearly, and provide the printed safe retry command. Never silently skip synchronization.
5. Never force-push, delete branches, bypass review, or commit directly to production `main`.
6. Never stage canonical databases, database files, backups, credentials, environment files, ownership markers, runtime artifacts, operational records, or synced `sources/` material.
7. Database backup and migration procedures remain separate from Git source control. Do not migrate, reset, reseed, open, or alter the canonical database as part of a source checkpoint.

The guarded checkpoint command performs its own source allowlist, sensitive-path scan, critical regression suite, push, and remote-SHA verification. A pull request and successful GitHub checks are still required before merging to `main`.

## Permanent approved-task workflow

For every approved coding task, use this lifecycle and report the first incomplete state truthfully:

`Code → Focused Tests → GitHub Checkpoint → PR / Approved Merge → Guarded Activation → Live SHA and Browser Verification`

- Run only the focused tests relevant to the changed behavior plus the production build.
- After validation, use the guarded checkpoint command. Create the pull request automatically.
- UI-only pull requests may be merged automatically only after GitHub checks pass, GitHub reports no conflict, the head SHA is unchanged, and the changed-file/security review contains no migration, security, deployment, scheduler, credential, environment, database, backup, WAL, marker, or runtime artifact.
- Database migrations, security-sensitive changes, production configuration, deployment scripts, scheduler changes, or any ambiguous classification require explicit manager authorization before merge or activation.
- After an approved merge, synchronize the authoritative tracked-clean `main` checkout to the verified merge SHA and run `deployment/windows/Test-AndaluciaGuardedUiActivation.ps1`.
- Automatic UI activation is permitted only when the preflight returns `READY`. Use `deployment/windows/Invoke-AndaluciaApprovedUiActivation.ps1` with the verified SHA and the applicable authorization. Never force-stop a process, delete a marker, weaken a scheduler setting, or start a second canonical owner.
- A health check is not visual proof. Report `LIVE VERIFIED` only after `/api/health` matches GitHub `main` and the changed UI is visible in the actual desktop and mobile application.
- Report only `CODE PASS`, `GITHUB SYNC`, `LIVE VERIFIED`, or the exact blocker.
