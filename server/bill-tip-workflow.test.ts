import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { createFinancialFinalizationFingerprint, createOperationalFingerprint } from './database-backup.js'
import type { BackupInventoryItem } from './database-backup-admin.js'
import { BillTipWorkflowService } from './bill-tip-workflow-service.js'
import { runMigrations } from './migration-store.js'
import { SUPPORTED_SCHEMA_VERSION, type DatabaseHealth } from './database-protection.js'

const root = await mkdtemp(join(tmpdir(), 'andalucia-bill-tip-workflow-'))
const canonical = join(root, 'data', 'postgres'); const backupRoot = join(root, 'backups'); const recoveryRoot = join(root, 'recovery')
await mkdir(canonical, { recursive: true }); await mkdir(backupRoot, { recursive: true })
const db = new PGlite(canonical)
try {
  await db.exec(await readFile('database/schema.sql', 'utf8')); await runMigrations(db)
  const health: DatabaseHealth = { status: 'HEALTHY', storeId: 'isolated', storeRole: 'test', migrationVersion: SUPPORTED_SCHEMA_VERSION, migrationRequired: false, recoveryRequired: false, lastVerifiedBackup: null, checks: [] }
  const operationalFingerprint = await createOperationalFingerprint(db); const financialFinalizationFingerprint = await createFinancialFinalizationFingerprint(db)
  const valid: BackupInventoryItem = { backupId: 'isolated-pre-finalization', category: 'pre-finalization', createdAt: new Date().toISOString(), verificationStatus: 'VERIFIED', schemaVersion: SUPPORTED_SCHEMA_VERSION, sizeBytes: 1, protected: true, protectionReasons: ['Isolated workflow test'], restoreTestStatus: 'RESTORE_TEST_PASSED', latestRestoreTestAt: new Date().toISOString(), operationalFingerprint, financialFinalizationFingerprint }
  let inventory: BackupInventoryItem[] = []
  const admin = { backupRoot, inventory: async () => inventory } as any
  const service = new BillTipWorkflowService(db, health, admin, canonical, recoveryRoot, () => '2026-09-11')
  assert.deepEqual((await service.safety()).blockers, ['VERIFIED_PRE_FINALIZATION_BACKUP_REQUIRED'])
  inventory = [{ ...valid, verificationStatus: 'INVALID' }]; assert.equal((await service.safety()).ready, false)
  inventory = [{ ...valid, restoreTestStatus: 'RESTORE_TEST_FAILED' }]; assert.equal((await service.safety()).ready, false)
  inventory = [{ ...valid, protected: false }]; assert.equal((await service.safety()).ready, false)
  inventory = [{ ...valid, financialFinalizationFingerprint: { invalid: true } }]; assert.equal((await service.safety()).ready, false)
  inventory = [valid]; assert.equal((await service.safety(valid.backupId)).ready, true)
  const staleSchema = new BillTipWorkflowService(db, { ...health, migrationVersion: '012' }, admin, canonical, recoveryRoot)
  assert((await staleSchema.safety()).blockers.includes('CURRENT_SUPPORTED_SCHEMA_REQUIRED'))
  const unhealthy = new BillTipWorkflowService(db, { ...health, status: 'DATABASE_RECOVERY_REQUIRED', recoveryRequired: true }, admin, canonical, recoveryRoot)
  assert((await unhealthy.safety()).blockers.includes('DATABASE_NOT_HEALTHY')); assert((await unhealthy.safety()).blockers.includes('DATABASE_RECOVERY_REQUIRED'))
  await mkdir(join(backupRoot, '.db2', 'scheduler'), { recursive: true }); await writeFile(join(backupRoot, '.db2', 'scheduler', 'job.lock'), 'isolated')
  assert((await service.safety()).blockers.includes('BACKUP_OR_REHEARSAL_IN_PROGRESS'))
  await rm(join(backupRoot, '.db2', 'scheduler', 'job.lock'))
  await writeFile(join(root, 'data', 'migration-in-progress'), 'isolated')
  assert((await service.safety()).blockers.includes('MIGRATION_IN_PROGRESS'))
  console.log(JSON.stringify({ currentSupportedSchema: SUPPORTED_SCHEMA_VERSION, staleSchemaBlocked: true, missingBackupBlocked: true, failedBackupBlocked: true, unprotectedBackupBlocked: true, fingerprintMismatchBlocked: true, verifiedRestoreTestedBackupAccepted: true, unhealthyDatabaseBlocked: true, recoveryBlocked: true, schedulerConflictBlocked: true, migrationConflictBlocked: true }, null, 2))
} finally { await db.close(); await rm(root, { recursive: true, force: true }) }
