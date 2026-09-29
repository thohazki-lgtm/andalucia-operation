import { isAbsolute, resolve } from 'node:path'
import { BACKUP_EXCLUSIVE_PHRASE, createVerifiedBackup, type BackupCategory } from './database-backup.js'
import { canonicalStoreDirectory } from './database-protection.js'
import { defaultExclusiveAccessCheck } from './migration-live-gate.js'
import { acquireDatabaseSchedulerLock } from './database-scheduler.js'

const configured = process.env.ANDALUCIA_DATA_DIR?.trim()
if (!configured || !isAbsolute(configured)) throw new Error('ANDALUCIA_DATA_DIR_REQUIRED')
if (resolve(configured) !== canonicalStoreDirectory) throw new Error('BACKUP_WRONG_STORE')
const category = (process.argv[2] || 'manual') as BackupCategory
if (!['automatic-daily', 'automatic-weekly', 'manual', 'pre-migration', 'pre-finalization', 'milestone', 'recovery', 'post-recovery-baseline', 'post-db1-protection-baseline', 'post-stale-marker-recovery'].includes(category)) throw new Error('BACKUP_CATEGORY_INVALID')
const confirmed = process.env.ANDALUCIA_CONFIRM_LIVE_STORE_EXCLUSIVE === BACKUP_EXCLUSIVE_PHRASE && await defaultExclusiveAccessCheck()
const backupRoot = resolve('.backups')
const lock = await acquireDatabaseSchedulerLock({ backupRoot, canonicalDirectory: configured, job: 'manual-backup' })
try {
  const result = await createVerifiedBackup({ sourceDirectory: configured, category, backupRoot, exclusiveConfirmed: confirmed })
  console.log(JSON.stringify({ backupId: result.metadata.backupId, backupDirectory: result.backupDirectory, manifest: result.metadata.backupManifest.aggregateSha256, verificationStatus: result.metadata.verificationStatus, openTestStatus: result.metadata.openTestStatus, preflightStatus: result.metadata.preflightStatus }, null, 2))
  await lock.release('SUCCEEDED', { category, backupId: result.metadata.backupId, verificationResult: 'VERIFIED' })
} catch (error) {
  await lock.release('FAILED', { category, error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) })
  throw error
}
