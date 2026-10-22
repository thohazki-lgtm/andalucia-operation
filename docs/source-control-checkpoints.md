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

## Remote checks

Pull requests and checkpoint branches run the GitHub source-checkpoint validation workflow. The workflow rebuilds the application and reruns the critical Schema 026, Schema 027, and official-timesheet export tests from a clean dependency installation.
