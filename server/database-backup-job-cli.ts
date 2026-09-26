import { isAbsolute, join, resolve } from 'node:path'
import { BACKUP_EXCLUSIVE_PHRASE, createVerifiedBackup, type BackupCategory } from './database-backup.js'
import { DatabaseBackupAdminService } from './database-backup-admin.js'
import { canonicalStoreDirectory } from './database-protection.js'
import { defaultExclusiveAccessCheck } from './migration-live-gate.js'
import { acquireDatabaseSchedulerLock, type DatabaseSchedulerJob } from './database-scheduler.js'

const configured = process.env.ANDALUCIA_DATA_DIR?.trim()
if (!configured || !isAbsolute(configured) || resolve(configured) !== canonicalStoreDirectory) throw new Error('BACKUP_WRONG_STORE')
const admin = new DatabaseBackupAdminService(resolve('.backups'), configured)
const command = process.argv[2] || 'status'
if (command === 'status') console.log(JSON.stringify({ policy: await admin.ensurePolicy(), inventory: await admin.inventory(), retention: await admin.retentionPlan(), storage: await admin.storage() }, null, 2))
else {
  const jobs: Record<string, DatabaseSchedulerJob> = { rehearse: 'weekly-restore-rehearsal', 'retention-plan': 'retention', 'retention-apply': 'retention', daily: 'daily-backup', weekly: 'daily-backup', requested: 'requested-backup' }
  const job = jobs[command]
  if (!job) throw new Error('DB2_JOB_COMMAND_INVALID')
  const lock = await acquireDatabaseSchedulerLock({ backupRoot: resolve('.backups'), canonicalDirectory: configured, job })
  try {
    if (command === 'rehearse') { const backupId = process.argv[3] || (await admin.inventory()).find(item => item.verificationStatus === 'VERIFIED')?.backupId; if (!backupId) throw new Error('VERIFIED_BACKUP_REQUIRED'); const result = await admin.rehearse(backupId); console.log(JSON.stringify(result, null, 2)); await lock.release('SUCCEEDED', { backupId, restoreStatus: result.status }); }
    else if (command === 'retention-plan') { const result = await admin.retentionPlan(); console.log(JSON.stringify(result, null, 2)); await lock.release('SUCCEEDED', { removalCount: result.remove.length }); }
    else if (command === 'retention-apply') { const result = await admin.applyRetention(process.env.ANDALUCIA_CONFIRM_RETENTION || ''); console.log(JSON.stringify(result, null, 2)); await lock.release('SUCCEEDED', { removalCount: result.remove.length }); }
    else {
      if (process.env.ANDALUCIA_CONFIRM_LIVE_STORE_EXCLUSIVE !== BACKUP_EXCLUSIVE_PHRASE || !(await defaultExclusiveAccessCheck())) throw new Error('BACKUP_REQUIRES_OFFLINE_EXCLUSIVE_ACCESS')
      let category: BackupCategory; let request: Awaited<ReturnType<typeof admin.pendingRequest>> = null
      if (command === 'daily') category = 'automatic-daily'
      else if (command === 'weekly') category = 'automatic-weekly'
      else { request = await admin.pendingRequest(); if (!request) throw new Error('BACKUP_REQUEST_NOT_FOUND'); category = 'manual' }
      try {
        const backup = await createVerifiedBackup({ sourceDirectory: configured, category, backupRoot: resolve('.backups'), exclusiveConfirmed: true })
        await admin.recordBackup(category, backup.metadata.backupId, true)
        if (request) await admin.completeRequest(request.path, backup.metadata.backupId)
        const retention = command === 'daily' || command === 'weekly' ? await admin.applyRetention('YES_I_APPROVE_DB2_RETENTION') : null
        console.log(JSON.stringify({ backupId: backup.metadata.backupId, category, status: 'VERIFIED', metadataPath: join(backup.folder, 'backup-metadata.json'), retentionRemoved: retention?.remove.length || 0 }, null, 2))
        await lock.release('SUCCEEDED', { category, backupId: backup.metadata.backupId, verificationResult: 'VERIFIED', retentionRemoved: retention?.remove.length || 0 })
      } catch (error) { await admin.recordBackup(category, 'failed-attempt', false, error); throw error }
    }
  } catch (error) {
    await lock.release('FAILED', { command, error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) })
    throw error
  }
}
