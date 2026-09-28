import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { createVerifiedBackup } from './database-backup.js'
import { DatabaseBackupAdminService } from './database-backup-admin.js'
import { STORE_IDENTITY_AUTHORIZATION, createStoreIdentity, type DatabaseHealth } from './database-protection.js'
import { createStoreManifest, manifestsMatch, writeJsonAtomic } from './migration-filesystem.js'
import { reviewedMigrationSet } from './migration-store.js'

const root = await mkdtemp(join(tmpdir(), 'andalucia-db2-'))
const canonical = join(root, 'canonical', 'postgres'); const backupRoot = join(root, 'backups'); const recoveryEvidence = join(root, 'recovery', 'forensic-evidence.txt')
const schema = await readFile('database/schema.sql', 'utf8')
const actor = { userId: randomUUID(), displayName: 'Isolated Owner' }
const createFixture = async () => {
  await mkdir(join(root, 'canonical'), { recursive: true }); const db = new PGlite(canonical); await db.exec(schema); await db.exec(await readFile('database/migrations/001_schema_migrations.sql', 'utf8'))
  for (const migration of (await reviewedMigrationSet()).versions.filter(item => item.version <= '018')) await db.query("insert into schema_migrations(version,name,checksum,status,actor_source,notes) values($1,$2,$3,'applied','isolated DB-2 test','')", [migration.version, migration.name, migration.checksum])
  await db.query("insert into outlet_scopes(id,scope_key,display_name,active,outlet_type) values('00000000-0000-4000-8000-00000000a001','andalucia','Andalucía',true,'restaurant')")
  await db.query("insert into authorization_roles(id,role_key,display_name,active,global_scope) values('00000000-0000-4000-8000-000000001001','owner','Owner / Super Admin',true,true)")
  await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status) values('00000000-0000-4000-8000-000000009001','isolated.owner','isolated.owner','Isolated Owner','unused','active')")
  await db.query("insert into authorization_user_roles(id,user_id,role_id,active) values('00000000-0000-4000-8000-000000009002','00000000-0000-4000-8000-000000009001','00000000-0000-4000-8000-000000001001',true)")
  await db.close(); await createStoreIdentity(canonical, 'canonical', { authorization: STORE_IDENTITY_AUTHORIZATION, expectedCanonicalDirectory: canonical, storeId: 'isolated-db2-canonical' })
}
const fakeMetadata = async (id: string, category: string, createdAt: string, overrides: Record<string, unknown> = {}) => {
  const folder = join(backupRoot, id); const databaseFolder = join(folder, 'postgres'); await mkdir(databaseFolder, { recursive: true }); const manifest = await createStoreManifest(databaseFolder)
  await writeJsonAtomic(join(folder, 'backup-metadata.json'), { backupId: id, createdAt, category, verificationStatus: 'VERIFIED', openTestStatus: 'PASS', preflightStatus: 'READY', sourceDirectory: canonical, backupDirectory: join(folder, 'postgres'), sourceManifest: manifest, backupManifest: manifest, schemaVersion: '014', operationalFingerprint: { staff: { count: 12 } }, migrationLedger: { migrations: [] }, ...overrides })
  return folder
}

try {
  await createFixture(); await mkdir(recoveryEvidence.substring(0, recoveryEvidence.lastIndexOf('\\')), { recursive: true }); await writeFile(recoveryEvidence, 'retain', 'utf8')
  const admin = new DatabaseBackupAdminService(backupRoot, canonical); const policy = await admin.ensurePolicy(); assert.equal(policy.retention.daily, 7); assert.equal(policy.retention.weekly, 8)
  const healthy = await createVerifiedBackup({ sourceDirectory: canonical, category: 'manual', backupRoot, exclusiveConfirmed: true, expectedCanonicalDirectory: canonical })
  await admin.recordBackup('manual', healthy.metadata.backupId, true)
  const originalBefore = await createStoreManifest(healthy.backupDirectory); const passed = await admin.rehearse(healthy.metadata.backupId, actor); assert.equal(passed.status, 'RESTORE_TEST_PASSED'); assert.equal(manifestsMatch(originalBefore, await createStoreManifest(healthy.backupDirectory)), true)
  assert.equal((await admin.pin(healthy.metadata.backupId, true, actor)).protected, true); assert.equal((await admin.pin(healthy.metadata.backupId, false, actor)).protected, false)
  assert.equal((await readdir(join(admin.adminRoot, 'rehearsals')).catch(() => [])).length, 0)

  const clone = async (suffix: string, mutate: (metadata: any, folder: string) => Promise<void> | void) => { const id = `${healthy.metadata.backupId}-${suffix}`; const folder = join(backupRoot, id); await cp(healthy.folder, folder, { recursive: true }); const metadata = JSON.parse(await readFile(join(folder, 'backup-metadata.json'), 'utf8')); metadata.backupId = id; metadata.backupDirectory = join(folder, 'postgres'); await mutate(metadata, folder); await writeJsonAtomic(join(folder, 'backup-metadata.json'), metadata); await rm(join(folder, 'restore-test.json'), { force: true }); return id }
  const fingerprintMismatch = await clone('fingerprint-drift', metadata => { metadata.operationalFingerprint.staff.count = 999 }); await assert.rejects(admin.rehearse(fingerprintMismatch), /FINGERPRINT_MISMATCH/)
  const migrationMismatch = await clone('migration-drift', metadata => { metadata.migrationLedger = { migrations: [] } }); await assert.rejects(admin.rehearse(migrationMismatch), /MIGRATION_MISMATCH/)
  const manifestMismatch = await clone('manifest-drift', async (_metadata, folder) => { await writeFile(join(folder, 'postgres', 'PG_VERSION'), 'changed\n', 'utf8') }); await assert.rejects(admin.rehearse(manifestMismatch), /MANIFEST_MISMATCH/)
  const preflightFailure = await clone('preflight-failure', async (metadata, folder) => { const db = new PGlite(join(folder, 'postgres')); await db.query("insert into bookings(id,guest_name,booking_status,covers,reservation_date) values($1,'Invalid DB-2 fixture','confirmed',0,'2026-09-11')", [randomUUID()]); await db.close(); const manifest = await createStoreManifest(join(folder, 'postgres')); metadata.sourceManifest = manifest; metadata.backupManifest = manifest }); await assert.rejects(admin.rehearse(preflightFailure), /PREFLIGHT/)
  const sqlFailure = 'sql-open-failure'; const sqlFolder = join(backupRoot, sqlFailure); await mkdir(join(sqlFolder, 'postgres'), { recursive: true }); await writeFile(join(sqlFolder, 'postgres', 'PG_VERSION'), '18\n'); const sqlManifest = await createStoreManifest(join(sqlFolder, 'postgres')); await fakeMetadata(sqlFailure, 'manual', new Date().toISOString(), { backupDirectory: join(sqlFolder, 'postgres'), sourceManifest: sqlManifest, backupManifest: sqlManifest, operationalFingerprint: healthy.metadata.operationalFingerprint, migrationLedger: healthy.metadata.migrationLedger }); await assert.rejects(admin.rehearse(sqlFailure), /OPEN_TEST/)

  const now = Date.now(); for (let index = 0; index < 9; index++) await fakeMetadata(`daily-${index}`, 'automatic-daily', new Date(now - index * 86400000).toISOString())
  for (let index = 0; index < 10; index++) await fakeMetadata(`weekly-${index}`, 'automatic-weekly', new Date(now - index * 7 * 86400000).toISOString())
  await fakeMetadata('accepted-db1-baseline', 'post-db1-protection-baseline', new Date(now - 20 * 86400000).toISOString())
  await assert.rejects(admin.pin('accepted-db1-baseline', false, actor), /BACKUP_PROTECTION_REQUIRED/)
  await fakeMetadata('pre-migration-protected', 'pre-migration', new Date(now - 30 * 86400000).toISOString())
  await writeJsonAtomic(join(backupRoot, 'invalid-attempt', 'backup-failure.json'), { createdAt: new Date().toISOString(), verificationStatus: 'INVALID' })
  await admin.pin('daily-8', true, actor); const plan = await admin.retentionPlan(); assert.equal(plan.remove.some(item => item.backupId === 'daily-8'), false); assert.equal(plan.remove.some(item => item.backupId === 'daily-7'), true); assert.equal(plan.remove.filter(item => item.category === 'automatic-weekly').length, 2); assert.equal(plan.remove.some(item => item.backupId === 'accepted-db1-baseline' || item.backupId === 'pre-migration-protected' || item.backupId === 'invalid-attempt'), false)
  await assert.rejects(admin.applyRetention('wrong'), /RETENTION_EXPLICIT_AUTHORIZATION_REQUIRED/); await admin.applyRetention('YES_I_APPROVE_DB2_RETENTION'); assert.equal(await readFile(recoveryEvidence, 'utf8'), 'retain')
  const request = await admin.requestManualBackup(actor); assert.equal(request.state, 'pending'); assert.equal((await admin.pendingRequest())?.value.id, request.id)
  assert.equal((await admin.inspect(healthy.metadata.backupId, actor)).backupId, healthy.metadata.backupId)
  const inventory = await admin.inventory(); assert.equal(inventory.find(item => item.backupId === healthy.metadata.backupId)?.restoreTestStatus, 'RESTORE_TEST_PASSED'); assert.equal(inventory.find(item => item.backupId === fingerprintMismatch)?.restoreTestStatus, 'RESTORE_TEST_FAILED'); assert.equal(admin.rankRecoveryCandidates(inventory).some(item => item.backupId === fingerprintMismatch), false)
  const database: DatabaseHealth = { status: 'HEALTHY', storeId: 'isolated-db2-canonical', storeRole: 'canonical', migrationVersion: '018', migrationRequired: false, recoveryRequired: false, lastVerifiedBackup: null, checks: [] }
  const schedulerLog = join(admin.adminRoot, 'scheduler', 'logs', 'windows-task-events.jsonl'); await mkdir(join(admin.adminRoot, 'scheduler', 'logs'), { recursive: true }); await writeFile(schedulerLog, `${JSON.stringify({ version: 'andalucia-windows-scheduler-event-v1', event: 'windows_task_finished', task: 'DailyBackup', finishedAt: '2026-09-11T01:00:00.000Z', result: 'FAILED', exitCode: 1, classification: 'isolated failure', restartResult: 'NOT_REQUIRED' })}\n`)
  const failedSummary = await admin.summary(database); assert.equal(failedSummary.warnings.includes('Scheduled backup requires attention.'), true)
  await appendFile(schedulerLog, `${JSON.stringify({ version: 'andalucia-windows-scheduler-event-v1', event: 'windows_task_finished', task: 'DailyBackup', finishedAt: '2026-09-11T02:00:00.000Z', result: 'SUCCEEDED', exitCode: 0, classification: '', restartResult: 'SUCCEEDED' })}\n`)
  const summary = await admin.summary(database); assert.equal(summary.storage.verifiedBackupCount > 0, true); assert.equal(summary.lastRestoreTest?.backupId, healthy.metadata.backupId); assert.equal(summary.recoveryReadiness, 'READY'); assert.equal(summary.warnings.includes('Scheduled backup requires attention.'), false)
  assert.equal(summary.pendingBackupRequest?.id, request.id)
  const audit = await readFile(join(admin.adminRoot, 'audit.jsonl'), 'utf8'); assert.match(audit, /manual_backup_requested/); assert.match(audit, /restore_rehearsal_completed/); assert.match(audit, /restore_rehearsal_failed/); assert.match(audit, /retention_cleanup/); assert.match(audit, /backup_pinned/)
  assert.match(audit, /recovery_candidate_inspected/)
  console.log(JSON.stringify({ automatedPolicy: true, offlineExecutionRequired: true, dailyRotation: true, weeklyRotation: true, pinnedPreserved: true, recoveryBaselinePreserved: true, preMigrationPreserved: true, invalidBackupPreserved: true, insufficientBackupProtection: true, forensicEvidencePreserved: true, healthyRestorePassed: true, manifestMismatchFailed: true, sqlOpenFailureFailed: true, preflightFailureFailed: true, fingerprintMismatchFailed: true, migrationMismatchFailed: true, disposableRehearsalCleaned: true, originalBackupByteStable: true, driftExcludedFromRanking: true, inventory: true, storageMonitoring: true, schedulerOutcomeWarning: true, recoveryReady: true, audit: true }, null, 2))
} finally { await rm(root, { recursive: true, force: true }) }
