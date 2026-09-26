import { isAbsolute, resolve } from 'node:path'
import { BACKUP_EXCLUSIVE_PHRASE, createVerifiedBackup, type BackupCategory } from './database-backup.js'
import { canonicalStoreDirectory } from './database-protection.js'
import { defaultExclusiveAccessCheck } from './migration-live-gate.js'

const configured = process.env.ANDALUCIA_DATA_DIR?.trim()
if (!configured || !isAbsolute(configured)) throw new Error('ANDALUCIA_DATA_DIR_REQUIRED')
if (resolve(configured) !== canonicalStoreDirectory) throw new Error('BACKUP_WRONG_STORE')
const category = (process.argv[2] || 'manual') as BackupCategory
if (!['automatic-daily', 'automatic-weekly', 'manual', 'pre-migration', 'pre-finalization', 'milestone', 'recovery', 'post-recovery-baseline', 'post-db1-protection-baseline', 'post-stale-marker-recovery'].includes(category)) throw new Error('BACKUP_CATEGORY_INVALID')
const confirmed = process.env.ANDALUCIA_CONFIRM_LIVE_STORE_EXCLUSIVE === BACKUP_EXCLUSIVE_PHRASE && await defaultExclusiveAccessCheck()
const result = await createVerifiedBackup({ sourceDirectory: configured, category, backupRoot: resolve('.backups'), exclusiveConfirmed: confirmed })
console.log(JSON.stringify({ backupId: result.metadata.backupId, backupDirectory: result.backupDirectory, manifest: result.metadata.backupManifest.aggregateSha256, verificationStatus: result.metadata.verificationStatus, openTestStatus: result.metadata.openTestStatus, preflightStatus: result.metadata.preflightStatus }, null, 2))
