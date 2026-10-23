# Guarded source checkpoints

The operational database and source-code backup are separate systems. GitHub must never contain canonical database files, database backups, credentials, environment files, ownership markers, or runtime artifacts.

## After a successfully validated coding task

1. Work on a development or recovery branch, never directly on `main`.
2. Review the changes and make sure the task-specific checks pass.
3. Run the guarded checkpoint command:

   ```powershell
   npm run source:checkpoint -- -Message "Describe the completed task"
   ```

The command stages only the approved source allowlist, blocks prohibited paths and recognizable embedded credentials, runs the production build plus the Schema 026, Schema 027, and official-timesheet export regressions, creates a commit, pushes the current branch, and verifies that the remote SHA matches. If the push fails, the local commit remains intact and the command prints the exact safe retry command.

Use `-Validation BuildOnly` only when the full focused suite has already passed in the same task and that evidence is recorded. A pull request into `main` remains mandatory; never force-push or bypass branch review.

At this point the task is **SOURCE COMPLETE**, not live. A successful checkpoint deliberately does not merge, deploy, restart the application, or touch the canonical database.

## Remote checks

Pull requests and checkpoint branches run the GitHub source-checkpoint validation workflow. The workflow rebuilds the application and reruns the critical Schema 026, Schema 027, and official-timesheet export tests from a clean dependency installation.

## After an approved merge

1. Verify GitHub reports the pull request merged and record the merge SHA.
2. Synchronize the single authoritative production checkout to the reviewed `origin/main`; require a clean `main` whose local SHA exactly matches `origin/main`.
3. Run the established read-only runtime, scheduler, backup, canonical identity, Schema 027, process-ownership, marker, and recovery preflight.
4. If any ownership, marker, WAL, recovery, backup, or scheduler gate is ambiguous, stop. Never force a process, remove a marker, or bypass the guard.
5. With explicit maintenance authorization, use `deployment/windows/Start-AndaluciaGuardedApplication.ps1`. Do not start a second canonical runtime.
6. Verify `/api/health` reports the reviewed merge SHA, branch `main`, Schema 027, and no migration or recovery requirement.
7. Verify the changed workflow in the actual browser at its required desktop and mobile widths.

Only after the health response and rendered browser both match the approved source is the task **LIVE VERIFIED**. A passing source build, checkpoint, pull request, or merge alone must never be reported as live activation.

The required lifecycle is:

`Code → Focused Tests → GitHub Checkpoint → PR / Approved Merge → Authorized Guarded Activation → Live SHA and Browser Verification`

## Guarded UI release commands

After GitHub merge and authoritative-checkout synchronization, run the non-mutating release gate:

```powershell
npm run release:ui:preflight -- -ExpectedSha <verified-main-sha>
```

It requires synchronized tracked-clean `main`, canonical identity, a healthy active Schema 027 runtime, unambiguous repository-owned listeners and marker, safe installed scheduler settings, and a verified restore-tested backup no older than 24 hours. It also compares the active runtime SHA with the target and blocks non-UI paths. A reviewed mixed release requires separate manager authorization and the explicit `-AllowReviewedNonUiPaths` flag.

The activation command defaults to preparation only:

```powershell
npm run release:ui:activate -- -ExpectedSha <verified-main-sha>
```

It returns `READY_AWAITING_RESTART_AUTHORIZATION` without stopping anything. Only an applicable manager authorization permits adding `-ManagerAuthorizedRestart`. The command then uses the existing graceful stop, requires ports and the canonical marker to release naturally, starts the installed guarded runtime task once, and requires `/api/health` to report the target SHA, `main`, healthy Schema 027, and no migration or recovery requirement. It never removes a marker, force-stops a process, edits scheduler configuration, migrates a database, or retries an ambiguous activation.

Browser verification remains a distinct final gate. The automation reports `HEALTH_VERIFIED`, not `LIVE VERIFIED`; an agent must confirm the changed desktop and mobile UI before the release is complete.
