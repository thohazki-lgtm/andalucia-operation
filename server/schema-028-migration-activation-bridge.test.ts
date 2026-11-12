import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { createDisposableTestRoot } from './test-store-fixture.js'
import { createMigrationFingerprint, migrationStatus, runMigrations } from './migration-store.js'
import { prepareCompletedSchema028Activation, runRequestedBackupActivationControl } from './requested-backup-activation-control.js'

const root = await createDisposableTestRoot('schema-028-activation-bridge')
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const write = async (path: string, value: unknown) => { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8') }
const closed = { portsClosed: async () => true }
try {
  git('init'); git('config', 'user.email', 'schema-bridge@andalucia.invalid'); git('config', 'user.name', 'Schema Bridge Test'); git('branch', '-M', 'main')
  await writeFile(join(root, '.gitignore'), '.data/\n.backups/\n.runtime/\n', 'utf8'); await writeFile(join(root, 'README.md'), 'previous runtime', 'utf8'); git('add', '.gitignore', 'README.md'); git('commit', '-m', 'previous runtime')
  const previousLiveSha = git('rev-parse', 'HEAD').toLowerCase(); await writeFile(join(root, 'README.md'), 'approved schema 028 source', 'utf8'); git('add', 'README.md'); git('commit', '-m', 'approved source')
  const targetSha = git('rev-parse', 'HEAD').toLowerCase(); git('update-ref', 'refs/remotes/origin/main', targetSha)

  const canonical = join(root, '.data', 'postgres'); await mkdir(canonical, { recursive: true })
  const db = new PGlite(canonical); await db.exec(await readFile('database/schema.sql', 'utf8')); await runMigrations(db)
  const status = await migrationStatus(db); const target = status.migrations.find(item => item.version === '028')!; const fingerprint = await createMigrationFingerprint(db); await db.close()
  const storeId = 'andalucia-canonical-live'; const outletScopeId = '00000000-0000-4000-8000-00000000a001'
  await write(join(root, '.data', 'andalucia-store-identity.json'), { role: 'canonical', storeId, databaseDirectory: canonical, outletScopeId })
  const backupId = 'andalucia-pre-migration-schema-028-bridge'; const folder = join(root, '.backups', backupId)
  const now = Date.now(); const createdAt = new Date(now - 60_000).toISOString(); const consumedAt = new Date(now - 30_000).toISOString(); const expiresAt = new Date(now + 20 * 60_000).toISOString()
  const artifact = {
    artifactVersion: 'andalucia-live-migration-authorization-v2', id: randomUUID(), state: 'consumed', createdAt, consumedAt, expiresAt,
    approvedSourceSha: targetSha, sourceDirectory: canonical, canonicalStoreId: storeId, outletScopeId,
    targetMigration: { version: '028', name: target.name, checksum: target.checksum },
    sourceMigrationLedger: { migrations: [{ version: '027', state: 'applied', checksumMatches: true }, { version: '028', state: 'pending', checksum: target.checksum, checksumMatches: null }] },
    protectedBackup: { backupId, pinned: true, restoreRehearsal: 'PASS' }, rehearsal: { status: 'PASS', rollbackSchema: '027', migratedSchema: '028' },
    consumedPostMigrationFingerprint: fingerprint.digest,
    ownerSession: { sessionId: randomUUID(), sessionExpiresAt: new Date(now + 30 * 60_000).toISOString(), userId: randomUUID(), loginIdentifier: 'owner.test', displayName: 'Owner Test', isOwner: true, globalScope: true, requiredPermissions: ['manage_platform', 'manage_duty_roster'] },
  }
  const metadata = { backupId, category: 'pre-migration', schemaVersion: '027', verificationStatus: 'VERIFIED', openTestStatus: 'PASS', preflightStatus: 'READY', createdAt }
  const restore = { backupId, status: 'RESTORE_TEST_PASSED', manifestMatch: true, fingerprintMatch: true, migrationMatch: true, preflightStatus: 'READY' }
  const result = { success: true, migration: { applied: ['028'] }, comparison: { preserved: true } }
  const artifactPath = join(folder, 'live-migration-authorization.json')
  await write(artifactPath, artifact); await write(join(folder, 'backup-metadata.json'), metadata); await write(join(folder, 'restore-test.json'), restore); await write(join(folder, 'migration-result.json'), result); await write(join(folder, 'migration-after-fingerprint.json'), { digest: fingerprint.digest })
  const approvedLine = JSON.stringify({ version: 'andalucia-guarded-startup-v1', recordedAt: new Date(now - 120_000).toISOString(), state: 'SOURCE_APPROVED', detail: `sha=${previousLiveSha};branch=main;mode=verified_main` })
  const exitedLine = JSON.stringify({ version: 'andalucia-guarded-startup-v1', recordedAt: new Date(now - 90_000).toISOString(), state: 'EXITED', detail: 'exitCode=0' })
  await write(join(root, '.runtime', 'logs', 'guarded-startup.jsonl'), `${approvedLine}\n${exitedLine}\n`)

  await assert.rejects(prepareCompletedSchema028Activation(root, 'f'.repeat(40), closed), /SCHEMA_028_ACTIVATION_SOURCE_MISMATCH/)
  await write(artifactPath, { ...artifact, state: 'prepared' }); await assert.rejects(prepareCompletedSchema028Activation(root, targetSha, closed), /SCHEMA_ACTIVATION_MIGRATION_INCOMPLETE/)
  await write(artifactPath, { ...artifact, expiresAt: new Date(now - 1).toISOString() }); await assert.rejects(prepareCompletedSchema028Activation(root, targetSha, closed), /SCHEMA_028_ACTIVATION_AUTHORIZATION_EXPIRED_OR_INVALID/)
  await write(artifactPath, artifact); await write(join(folder, 'backup-metadata.json'), { ...metadata, verificationStatus: 'FAILED' }); await assert.rejects(prepareCompletedSchema028Activation(root, targetSha, closed), /SCHEMA_ACTIVATION_BACKUP_EVIDENCE_INVALID/)
  await write(join(folder, 'backup-metadata.json'), metadata); await write(join(folder, 'restore-test.json'), { ...restore, fingerprintMatch: false }); await assert.rejects(prepareCompletedSchema028Activation(root, targetSha, closed), /SCHEMA_ACTIVATION_RESTORE_EVIDENCE_INVALID/)
  await write(join(folder, 'restore-test.json'), restore)

  const authorization = await prepareCompletedSchema028Activation(root, targetSha, closed)
  assert.equal(authorization.state, 'BACKUP_VERIFIED'); assert.equal(authorization.authorizationMode, 'schema_028_migration_activation'); assert.equal(authorization.backupId, backupId); assert.equal(authorization.previousLiveSha, previousLiveSha)
  await assert.rejects(prepareCompletedSchema028Activation(root, targetSha, closed), /CANONICAL_MAINTENANCE_REQUEST_ALREADY_AUTHORIZED/)
  const args = ['node', 'control', '--project-root', root, '--authorization-id', authorization.authorizationId]
  const inspected = await runRequestedBackupActivationControl('inspect-target', args, closed); assert.equal(inspected.state, 'BACKUP_VERIFIED')

  const originalArtifact = await readFile(artifactPath, 'utf8'); await writeFile(artifactPath, `${originalArtifact}\n`, 'utf8')
  await assert.rejects(runRequestedBackupActivationControl('inspect-target', args, closed), /SCHEMA_028_ACTIVATION_PROTECTED_BINDING_MISMATCH/)
  await writeFile(artifactPath, originalArtifact, 'utf8')
  const altered = new PGlite(canonical); await altered.query("update schema_migrations set checksum=$1 where version='028'", ['0'.repeat(64)]); await altered.close()
  await assert.rejects(runRequestedBackupActivationControl('inspect-target', args, closed), /SCHEMA_028_ACTIVATION_LIVE_MIGRATION_STATE_CHANGED/)
  const repaired = new PGlite(canonical); await repaired.query("update schema_migrations set checksum=$1 where version='028'", [target.checksum]); await repaired.close()

  const claims = await Promise.allSettled([runRequestedBackupActivationControl('claim-target', args, closed), runRequestedBackupActivationControl('claim-target', args, closed)])
  assert.equal(claims.filter(item => item.status === 'fulfilled').length, 1); assert.equal(claims.filter(item => item.status === 'rejected').length, 1)
  const healthy = await runRequestedBackupActivationControl('target-healthy', args, closed); assert.equal(healthy.state, 'TARGET_HEALTHY')
  await assert.rejects(runRequestedBackupActivationControl('claim-target', args, closed), /CANONICAL_MAINTENANCE_STATE_INVALID/)

  const preflight = await readFile('deployment/windows/Test-AndaluciaGuardedUiActivation.ps1', 'utf8')
  assert.match(preflight, /schema_028_migration_activation/); assert.match(preflight, /requiredBackupCategory[\s\S]*pre-migration/)
  console.log(JSON.stringify({ completedMigrationAuthorizationAccepted: true, exactSourceAndStoreBound: true, verifiedBackupAndRestoreRequired: true, managerAndExpiryRequired: true, stoppedRuntimeEvidenceBound: true, liveMigrationStateRechecked: true, replayRejected: true, concurrentClaimSerialized: true, singleUseTransition: true, canonicalDatabaseTouched: false }, null, 2))
} finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
