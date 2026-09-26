import { isAbsolute, resolve } from 'node:path'
import { DatabaseRecoveryService, RECOVERY_PROMOTION_CONFIRMATION, type RecoveryFailureClass } from './database-recovery.js'
import { canonicalStoreDirectory, defaultBackupRoot, readStoreIdentity, SUPPORTED_SCHEMA_VERSION, type DatabaseHealth } from './database-protection.js'
import { defaultExclusiveAccessCheck } from './migration-live-gate.js'

const configured = process.env.ANDALUCIA_DATA_DIR?.trim()
if (!configured || !isAbsolute(configured) || resolve(configured) !== canonicalStoreDirectory) throw new Error('RECOVERY_WRONG_CANONICAL_STORE')
const service = new DatabaseRecoveryService({ recoveryRoot: resolve('.recovery'), backupRoot: defaultBackupRoot, canonicalDirectory: configured })
const command = process.argv[2] || 'history'
if (command === 'history') console.log(JSON.stringify(await service.history(), null, 2))
else if (command === 'preview') { const id = process.argv[3]; if (!id) throw new Error('RECOVERY_INCIDENT_REQUIRED'); console.log(JSON.stringify(await service.preview(id), null, 2)) }
else if (command === 'detect') {
  const failureClass = process.argv[3] as RecoveryFailureClass; if (!failureClass) throw new Error('RECOVERY_FAILURE_CLASS_REQUIRED'); const identity = await readStoreIdentity(configured, 'canonical'); const candidate = (await service.discoverCandidates())[0]
  const health: DatabaseHealth = { status: 'DATABASE_RECOVERY_REQUIRED', storeId: identity.storeId, storeRole: 'canonical', migrationVersion: SUPPORTED_SCHEMA_VERSION, migrationRequired: false, recoveryRequired: true, lastVerifiedBackup: null, checks: [] }
  console.log(JSON.stringify(await service.detect({ failureClass, health, latestHealthyFingerprint: candidate?.operationalFingerprint as Record<string, unknown> || null }), null, 2))
} else if (command === 'promote') {
  const artifactFile = process.argv[3]; if (!artifactFile || !isAbsolute(artifactFile)) throw new Error('RECOVERY_AUTHORIZATION_ARTIFACT_REQUIRED'); console.log(JSON.stringify(await service.promoteOffline({ artifactFile, confirmation: process.env.ANDALUCIA_CONFIRM_RECOVERY_PROMOTION || '', exclusiveCheck: defaultExclusiveAccessCheck }), null, 2))
} else if (command === 'rollback') {
  const incidentId = process.argv[3]; if (!incidentId) throw new Error('RECOVERY_INCIDENT_REQUIRED'); console.log(JSON.stringify(await service.rollbackOffline({ incidentId, confirmation: process.env.ANDALUCIA_CONFIRM_RECOVERY_PROMOTION || '', exclusiveCheck: defaultExclusiveAccessCheck }), null, 2))
} else throw new Error('RECOVERY_COMMAND_INVALID')

if (['promote', 'rollback'].includes(command) && process.env.ANDALUCIA_CONFIRM_RECOVERY_PROMOTION !== RECOVERY_PROMOTION_CONFIRMATION) process.exitCode = 1
