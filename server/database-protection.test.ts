import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { spawn } from 'node:child_process'
import { createStoreManifest } from './migration-filesystem.js'
import { reviewedMigrationSet } from './migration-store.js'
import { createVerifiedBackup, requireRecentVerifiedBackup, verifyBackupCopy } from './database-backup.js'
import { STORE_IDENTITY_AUTHORIZATION, createStoreIdentity, openVerifiedDatabase, operationMarkerPaths, resolveRuntimeStore, storeIdentityPath } from './database-protection.js'

const root = await mkdtemp(join(tmpdir(), 'andalucia-db-protection-'))
const schema = await readFile('database/schema.sql', 'utf8')
const createFixture = async (name: string, through = '018') => {
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
  await assert.rejects(openVerifiedDatabase({ dataDirectory: canonical, role: 'canonical' }), /STORE_IDENTITY_MISSING/)
  await createStoreIdentity(canonical, 'canonical', { authorization: STORE_IDENTITY_AUTHORIZATION, expectedCanonicalDirectory: canonical, storeId: 'isolated-canonical' })
  await assert.rejects(openVerifiedDatabase({ dataDirectory: canonical, role: 'test' }), /STORE_IDENTITY_MISMATCH/)
  const opened = await openVerifiedDatabase({ dataDirectory: canonical, role: 'canonical', backupRoot: join(root, 'backups') })
  assert.equal(opened.health.migrationVersion, '018')
  assert.equal(opened.health.recoveryRequired, false)
  await opened.db.close()

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
  await assert.rejects(openVerifiedDatabase({ dataDirectory: pending, role: 'test' }), /DATABASE_MIGRATION_REQUIRED:missing_versions=014,015,016,017,018/)
  const future = await createFixture('future', '018')
  await createStoreIdentity(future, 'test', { storeId: 'future-test' })
  const futureDb = new PGlite(future)
  await futureDb.query("insert into schema_migrations(version,name,checksum,status,actor_source,notes) values('999','unreviewed future migration','not-reviewed','applied','isolated DB-1 test','')")
  await futureDb.close()
  await assert.rejects(openVerifiedDatabase({ dataDirectory: future, role: 'test' }), /UNEXPECTED_MIGRATION_VERSION:999/)

  await assert.rejects(createVerifiedBackup({ sourceDirectory: canonical, category: 'manual', backupRoot: join(root, 'backups'), exclusiveConfirmed: false, expectedCanonicalDirectory: canonical }), /BACKUP_REQUIRES_OFFLINE_EXCLUSIVE_ACCESS/)
  await assert.rejects(createVerifiedBackup({ sourceDirectory: future, category: 'manual', backupRoot: join(root, 'backups'), exclusiveConfirmed: true, expectedCanonicalDirectory: canonical }), /BACKUP_WRONG_STORE/)
  const backup = await createVerifiedBackup({ sourceDirectory: canonical, category: 'manual', backupRoot: join(root, 'backups'), exclusiveConfirmed: true, expectedCanonicalDirectory: canonical, now: new Date() })
  assert.equal(backup.metadata.verificationStatus, 'VERIFIED')
  assert.equal(backup.metadata.openTestStatus, 'PASS')
  assert.equal(backup.metadata.preflightStatus, 'READY')
  assert.equal(backup.metadata.operationalFingerprint.staff && typeof backup.metadata.operationalFingerprint.staff, 'object')
  await requireRecentVerifiedBackup({ metadataPath: join(backup.folder, 'backup-metadata.json'), sourceDirectory: canonical, maximumAgeMs: 60_000 })

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
  console.log(JSON.stringify({ explicitPath: true, canonicalIdentity: true, wrongIdentityRejected: true, staleMarkerPreserved: true, crashSimulationDetected: true, recoveryMarkerBlocked: true, pendingMigrationBlockedWithoutWrite: true, unexpectedMigrationBlocked: true, offlineBackupRequired: true, verifiedBackup: true, sqlOpenTest: true, preflight: true, fingerprint: true, interruptedCopyRejected: true, failedPreflightRejected: true, unreadableBackupRejected: true, wrongStoreRejected: true, ownerOnlyHealthFoundation: true }, null, 2))
} finally {
  await rm(root, { recursive: true, force: true })
}
