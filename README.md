# ANDALUCÍA OPERATION

First-phase operational foundation for the Andalucía restaurant at Siyam World Maldives.

## Run locally

Install Node.js 20+ and run `npm install`, then `npm run dev`. The development command explicitly binds the API to the canonical `.data/postgres` store and validates its identity and schema before accepting requests. It never creates an empty database or applies migrations.

See [Database protection](docs/database-protection.md) before stopping the API, creating a backup, running a migration, or responding to a database recovery diagnostic.

DB-2 adds offline daily/weekly job commands, protected backup inventory, retention planning, disposable restore rehearsal, and an Owner-only Database Health view in Customization Center. Local automation must use an external scheduler to provide the graceful shutdown/restart window; the application never performs a hot copy.

Install or safely update the Windows automation with `deployment/windows/Install-AndaluciaDatabaseScheduler.ps1`. The task definitions use the guarded application launcher and existing DB-2 commands; schedules, logs, validation, and safe disable/removal are documented in the database-protection guide.

## Controlled database migration

Migration commands always require an absolute `ANDALUCIA_MIGRATION_DATA_DIR`. Rehearsal targets remain the default. The live store cannot be migrated without a tooling-generated, current backup authorization artifact.

Live preparation requires the application to be stopped and the exact phrase:

`ANDALUCIA_CONFIRM_LIVE_STORE_EXCLUSIVE=YES_I_CONFIRM_ANDALUCIA_APP_IS_STOPPED`

After `npm run db:migrate:prepare-live` produces and verifies the backup artifact, live execution requires all of these explicit values:

- `ANDALUCIA_ALLOW_LIVE_MIGRATION=YES_I_APPROVE_LIVE_MIGRATION`
- `ANDALUCIA_LIVE_MIGRATION_AUTHORIZATION_FILE=<absolute path printed by prepare-live>`
- `ANDALUCIA_CONFIRM_LIVE_STORE_EXCLUSIVE=YES_I_CONFIRM_ANDALUCIA_APP_IS_STOPPED`
- `ANDALUCIA_MIGRATION_DATA_DIR=<exact absolute live-store path>`

The authorization artifact is source-state and migration-checksum bound, is revalidated immediately before migration, and is consumed after success. Never save these approval values in `.env` or application source.
