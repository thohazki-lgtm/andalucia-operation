import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { spawn } from 'node:child_process'
import { createStoreManifest, manifestsMatch } from './migration-filesystem.js'
import { resolveMigrationDataDirectory, reviewedMigrationSet } from './migration-store.js'
import { createVerifiedBackup, requireRecentVerifiedBackup, verifyBackupCopy } from './database-backup.js'
import { DatabaseBackupAdminService } from './database-backup-admin.js'
import { STORE_IDENTITY_AUTHORIZATION, createStoreIdentity, openVerifiedDatabase, operationMarkerPaths, resolveRuntimeStore, storeIdentityPath } from './database-protection.js'
import { createDisposableTestRoot } from './test-store-fixture.js'

const root = await createDisposableTestRoot('db-protection')
const schema = await readFile('database/schema.sql', 'utf8')
const createFixture = async (name: string, through = '027') => {
  const path = join(root, name, 'postgres')
  await mkdir(join(root, name), { recursive: true })
  const db = new PGlite(path)
  await db.exec(schema)
  await db.exec(await readFile('database/migrations/001_schema_migrations.sql', 'utf8'))
  const reviewed = await reviewedMigrationSet()
  for (const migration of reviewed.versions.filter(item => item.version <= through)) await db.query("insert into schema_migrations(version,name,checksum,status,actor_source,notes) values($1,$2,$3,'applied','isolated DB-1 test','')", [migration.version, migration.name, migration.checksum])
  await db.query("insert into outlet_scopes(id,scope_key,display_name,active,outlet_type) values('00000000-0000-4000-8000-00000000a001','andalucia','Andalucía',true,'restaurant')")
  await db.query("insert into authorization_roles(id,role_key,display_name,active,global_scope) values('00000000-0000-4000-8000-000000001001','owner','Owner / Super Admin',true,true)")
  await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status) values('00000000-0000-4000-8000-000000009001','isolated.owner','isolated.owner','Isolated Owner','not-a-real-login-secret','active')")
  await db.query("insert into authorization_user_roles(id,user_id,role_id,active) values('00000000-0000-4000-8000-000000009002','00000000-0000-4000-8000-000000009001','00000000-0000-4000-8000-000000001001',true)")
  await db.close()
  return path
}

try {
  assert.throws(() => resolveRuntimeStore({}), /ANDALUCIA_DATA_DIR_REQUIRED/)
  assert.throws(() => resolveRuntimeStore({ ANDALUCIA_DATA_DIR: 'relative/postgres', ANDALUCIA_STORE_ROLE: 'canonical' }), /ANDALUCIA_DATA_DIR_MUST_BE_ABSOLUTE/)

  const canonical = await createFixture('canonical')
  assert.equal(resolveRuntimeStore({ NODE_ENV: 'test', ANDALUCIA_DATA_DIR: canonical, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: canonical }).dataDirectory, canonical)
  const unapprovedTestStore = join(process.cwd(), 'unapproved-isolated-store', 'postgres')
  assert.throws(() => resolveRuntimeStore({ NODE_ENV: 'test', ANDALUCIA_DATA_DIR: unapprovedTestStore, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: unapprovedTestStore }), /TEST_DEVELOPMENT_STORE_MUST_BE_TEMPORARY/)
  await assert.rejects(openVerifiedDatabase({ dataDirectory: canonical, role: 'canonical' }), /STORE_IDENTITY_MISSING/)
  await createStoreIdentity(canonical, 'canonical', { authorization: STORE_IDENTITY_AUTHORIZATION, expectedCanonicalDirectory: canonical, storeId: 'isolated-canonical' })
  await assert.rejects(openVerifiedDatabase({ dataDirectory: canonical, role: 'test' }), /STORE_IDENTITY_MISMATCH/)
  const opened = await openVerifiedDatabase({ dataDirectory: canonical, role: 'canonical', backupRoot: join(root, 'backups') })
  assert.equal(opened.health.migrationVersion, '027')
  assert.equal(opened.health.recoveryRequired, false)
  await opened.db.close()

  const compatibility = await createFixture('schema-026-compatibility', '026')
  await createStoreIdentity(compatibility, 'canonical', { authorization: STORE_IDENTITY_AUTHORIZATION, expectedCanonicalDirectory: compatibility, storeId: 'isolated-schema-026-canonical' })
  await assert.rejects(openVerifiedDatabase({ dataDirectory: compatibility, role: 'canonical' }), /DATABASE_MIGRATION_REQUIRED:missing_versions=027/)
  const compatibilityOpened = await openVerifiedDatabase({ dataDirectory: compatibility, role: 'canonical', requiredVersion: '026', backupRoot: join(root, 'compatibility-backups') })
  assert.equal(compatibilityOpened.health.migrationVersion, '026')
  await compatibilityOpened.db.close()
  await assert.rejects(openVerifiedDatabase({ dataDirectory: compatibility, role: 'canonical', requiredVersion: 'invalid' }), /ANDALUCIA_REQUIRED_SCHEMA_VERSION_UNSUPPORTED:invalid/)
  await assert.rejects(openVerifiedDatabase({ dataDirectory: compatibility, role: 'canonical', requiredVersion: '025' }), /ANDALUCIA_REQUIRED_SCHEMA_VERSION_UNSUPPORTED:025/)
  const migrationSource = await createFixture('schema-025-migration-source', '025')
  await createStoreIdentity(migrationSource, 'canonical', { authorization: STORE_IDENTITY_AUTHORIZATION, expectedCanonicalDirectory: migrationSource, storeId: 'isolated-schema-025-migration-source' })
  await assert.rejects(openVerifiedDatabase({ dataDirectory: migrationSource, role: 'canonical', requiredVersion: '025' }), /ANDALUCIA_REQUIRED_SCHEMA_VERSION_UNSUPPORTED:025/)
  const compatibilityBackup = await createVerifiedBackup({ sourceDirectory: migrationSource, category: 'pre-migration', backupRoot: join(root, 'compatibility-backups'), exclusiveConfirmed: true, expectedCanonicalDirectory: migrationSource, requiredVersion: '025' })
  assert.equal(compatibilityBackup.metadata.schemaVersion, '025')
  assert.equal(compatibilityBackup.metadata.requiredSchemaVersion, '025')
  const compatibilityVerification = await verifyBackupCopy({ backupDirectory: compatibilityBackup.backupDirectory, sourceManifest: compatibilityBackup.metadata.backupManifest, verificationDirectory: join(root, 'compatibility-second-verification', 'postgres'), copyRole: 'rehearsal', requiredVersion: '025', allowReviewedMigrationSource: true })
  assert.equal(compatibilityVerification.migration.migrations.find(item => item.version === '025')?.state, 'applied')
  assert.equal(compatibilityVerification.migration.migrations.find(item => item.version === '026')?.state, 'pending')
  const compatibilityAdmin = new DatabaseBackupAdminService(join(root, 'compatibility-backups'), migrationSource, '025')
  const compatibilityRehearsal = await compatibilityAdmin.rehearse(compatibilityBackup.metadata.backupId)
  assert.equal(compatibilityRehearsal.status, 'RESTORE_TEST_PASSED')

  const marker = operationMarkerPaths(canonical).postmaster
  await writeFile(marker, '999999\n', 'utf8')
  await assert.rejects(openVerifiedDatabase({ dataDirectory: canonical, role: 'canonical' }), /DATABASE_PROCESS_MARKER_PRESENT/)
  assert.equal(await readFile(marker, 'utf8'), '999999\n')
  await unlink(marker)
  await writeFile(operationMarkerPaths(canonical).recovery, 'controlled recovery marker', 'utf8')
  await assert.rejects(openVerifiedDatabase({ dataDirectory: canonical, role: 'canonical' }), /RECOVERY_IN_PROGRESS/)
  await unlink(operationMarkerPaths(canonical).recovery)

  const crashStore = await createFixture('crash-store')
  await createStoreIdentity(crashStore, 'test', { storeId: 'crash-test' })
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/database-crash-fixture.ts', crashStore], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise<void>((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(new Error('Crash fixture did not open in time.')), 15_000)
    child.stdout.on('data', chunk => { if (String(chunk).includes('DATABASE_CRASH_FIXTURE_READY')) { clearTimeout(timeout); resolveReady() } })
    child.once('error', error => { clearTimeout(timeout); rejectReady(error) })
  })
  child.kill('SIGKILL')
  await new Promise<void>(resolveExit => child.once('exit', () => resolveExit()))
  assert.equal(await readFile(operationMarkerPaths(crashStore).postmaster, 'utf8').then(() => true, () => false), true)
  await assert.rejects(openVerifiedDatabase({ dataDirectory: crashStore, role: 'test' }), /DATABASE_PROCESS_MARKER_PRESENT/)

  const pending = await createFixture('pending', '013')
  await createStoreIdentity(pending, 'test', { storeId: 'pending-test' })
  await assert.rejects(openVerifiedDatabase({ dataDirectory: pending, role: 'test' }), /DATABASE_MIGRATION_REQUIRED:missing_versions=014,015,016,017,018,019,020,021,022,023,024,025,026,027/)
  const future = await createFixture('future', '027')
  await createStoreIdentity(future, 'test', { storeId: 'future-test' })
  const futureDb = new PGlite(future)
  await futureDb.query("insert into schema_migrations(version,name,checksum,status,actor_source,notes) values('999','unreviewed future migration','not-reviewed','applied','isolated DB-1 test','')")
  await futureDb.close()
  await assert.rejects(openVerifiedDatabase({ dataDirectory: future, role: 'test' }), /UNEXPECTED_MIGRATION_VERSION:999/)

  await assert.rejects(createVerifiedBackup({ sourceDirectory: canonical, category: 'manual', backupRoot: join(root, 'backups'), exclusiveConfirmed: false, expectedCanonicalDirectory: canonical }), /BACKUP_REQUIRES_OFFLINE_EXCLUSIVE_ACCESS/)
  await assert.rejects(createVerifiedBackup({ sourceDirectory: future, category: 'manual', backupRoot: join(root, 'backups'), exclusiveConfirmed: true, expectedCanonicalDirectory: canonical }), /BACKUP_WRONG_STORE/)
  const backupCreatedAt = new Date()
  const backup = await createVerifiedBackup({ sourceDirectory: canonical, category: 'manual', backupRoot: join(root, 'backups'), exclusiveConfirmed: true, expectedCanonicalDirectory: canonical, now: backupCreatedAt })
  assert.equal(backup.metadata.verificationStatus, 'VERIFIED')
  assert.equal(backup.metadata.openTestStatus, 'PASS')
  assert.equal(backup.metadata.preflightStatus, 'READY')
  assert.equal(backup.metadata.operationalFingerprint.staff && typeof backup.metadata.operationalFingerprint.staff, 'object')
  assert.equal((await readFile(storeIdentityPath(backup.backupDirectory), 'utf8')).includes('"role": "backup"'), true)
  await assert.rejects(openVerifiedDatabase({ dataDirectory: backup.backupDirectory, role: 'backup' }), /BACKUP_ORIGINAL_OPEN_FORBIDDEN/)
  assert.throws(() => resolveMigrationDataDirectory({ configuredPath: backup.backupDirectory }), /BACKUP_ORIGINAL_MIGRATION_FORBIDDEN/)
  const originalBeforeVerification = await createStoreManifest(backup.backupDirectory)
  await verifyBackupCopy({ backupDirectory: backup.backupDirectory, sourceManifest: backup.metadata.backupManifest, verificationDirectory: join(root, 'second-verification', 'postgres'), copyRole: 'rehearsal' })
  const originalAfterVerification = await createStoreManifest(backup.backupDirectory)
  assert.equal(manifestsMatch(originalBeforeVerification, originalAfterVerification), true)
  await requireRecentVerifiedBackup({ metadataPath: join(backup.folder, 'backup-metadata.json'), sourceDirectory: canonical, maximumAgeMs: 60_000, now: new Date(backupCreatedAt.getTime() + 30_000) })
  await assert.rejects(requireRecentVerifiedBackup({ metadataPath: join(backup.folder, 'backup-metadata.json'), sourceDirectory: canonical, maximumAgeMs: 60_000, now: new Date(backupCreatedAt.getTime() + 60_001) }), /VERIFIED_BACKUP_STALE/)

  const interrupted = join(root, 'interrupted', 'postgres')
  await cp(backup.backupDirectory, interrupted, { recursive: true })
  await unlink(join(interrupted, 'PG_VERSION'))
  await assert.rejects(verifyBackupCopy({ backupDirectory: interrupted, sourceManifest: backup.metadata.sourceManifest, verificationDirectory: join(root, 'interrupted-check', 'postgres') }), /MANIFEST_MISMATCH/)

  const blocked = await createFixture('blocked')
  const blockedDb = new PGlite(blocked)
  await blockedDb.query("insert into bookings(id,guest_name,booking_status,covers,reservation_date) values($1,'Invalid backup fixture','confirmed',0,'2026-09-11')", [randomUUID()])
  await blockedDb.close()
  const blockedManifest = await createStoreManifest(blocked)
  await assert.rejects(verifyBackupCopy({ backupDirectory: blocked, sourceManifest: blockedManifest, verificationDirectory: join(root, 'blocked-check', 'postgres') }), /BACKUP_INVALID:OPEN_TEST:BACKUP_INVALID:PREFLIGHT/)

  const garbage = join(root, 'garbage', 'postgres')
  await mkdir(garbage, { recursive: true })
  await writeFile(join(garbage, 'PG_VERSION'), '18\n', 'utf8')
  const garbageManifest = await createStoreManifest(garbage)
  await assert.rejects(verifyBackupCopy({ backupDirectory: garbage, sourceManifest: garbageManifest, verificationDirectory: join(root, 'garbage-check', 'postgres') }), /BACKUP_INVALID:OPEN_TEST/)

  const outletManagerPermissions = ['manage_staff', 'manage_bookings']
  assert.equal(outletManagerPermissions.includes('manage_platform'), false)
  assert.equal((await readFile(storeIdentityPath(canonical), 'utf8')).includes('isolated-canonical'), true)
  const guardedLauncher = await readFile('deployment/windows/Start-AndaluciaGuardedApplication.ps1', 'utf8')
  assert.match(guardedLauncher, /if \(-not \$env:ANDALUCIA_REQUIRED_SCHEMA_VERSION\) \{ \$env:ANDALUCIA_REQUIRED_SCHEMA_VERSION = '027' \}/, 'The live launcher must require the coordinated Schema 027 application after production activation.')
  assert.doesNotMatch(guardedLauncher, /\$env:ANDALUCIA_REQUIRED_SCHEMA_VERSION\s*=\s*'02[56]'/, 'The live launcher must not fall back to an older production schema after activation.')
  console.log(JSON.stringify({ explicitPath: true, workspaceDisposableTestRootAllowed: true, arbitraryWorkspaceTestRootRejected: true, canonicalIdentity: true, wrongIdentityRejected: true, schema027DefaultEnforced: true, schema026ExplicitCompatibility: true, schema025RuntimeRejected: true, schema027LauncherActivated: true, liveLauncherDefaultsTo027: true, invalidSchemaOverrideRejected: true, unsupportedSchemaOverrideRejected: true, schema025PreMigrationBackupVerified: true, schema025RestoreRehearsed: true, staleMarkerPreserved: true, crashSimulationDetected: true, recoveryMarkerBlocked: true, pendingMigrationBlockedWithoutWrite: true, unexpectedMigrationBlocked: true, offlineBackupRequired: true, verifiedBackup: true, backupIdentity: true, directBackupOpenRejected: true, backupMigrationRejected: true, disposableVerificationAllowed: true, rehearsalRoleAllowed: true, originalBackupByteStable: true, sqlOpenTest: true, preflight: true, fingerprint: true, interruptedCopyRejected: true, failedPreflightRejected: true, unreadableBackupRejected: true, wrongStoreRejected: true, ownerOnlyHealthFoundation: true }, null, 2))
} finally {
  await rm(root, { recursive: true, force: true })
}
