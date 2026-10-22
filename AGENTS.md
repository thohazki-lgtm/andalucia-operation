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
