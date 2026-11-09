import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const preflight = await readFile('deployment/windows/Test-AndaluciaGuardedUiActivation.ps1', 'utf8')
const workflow = await readFile('deployment/windows/Invoke-AndaluciaRequestedBackupUiActivation.ps1', 'utf8')

assert.match(preflight, /database\.status -notin @\('HEALTHY','BACKUP_RECOMMENDED'\)/)
assert.match(preflight, /SCHEMA_GATE_FAILED/)
assert.match(preflight, /verificationStatus -ne 'VERIFIED'/)
assert.match(preflight, /openTestStatus -ne 'PASS'/)
assert.match(preflight, /restore\.status -ne 'RESTORE_TEST_PASSED'/)
assert.match(preflight, /-not \$restore\.manifestMatch/)
assert.match(preflight, /-not \$restore\.fingerprintMatch/)
assert.match(preflight, /-not \$restore\.migrationMatch/)
assert.match(preflight, /VERIFIED_BACKUP_TOO_OLD/)
assert.match(workflow, /REQUESTED_BACKUP_PRE_SHUTDOWN_PREFLIGHT_NOT_EXCLUSIVELY_BACKUP_BLOCKED/)
assert.match(workflow, /npm\.cmd run db:backup:job -- requested/)
assert.match(workflow, /Invoke-Control 'bind-backup'/)
assert.match(workflow, /-MaintenanceAuthorizationId \$authorizationId/)

const decision = ({ ok = true, status = 'HEALTHY', schema = '027', migrationRequired = false, recoveryRequired = false, backup }) => {
  if (!ok || !['HEALTHY', 'BACKUP_RECOMMENDED'].includes(status)) return 'DATABASE_NOT_HEALTHY'
  if (schema !== '027' || migrationRequired || recoveryRequired) return 'SCHEMA_GATE_FAILED'
  if (!backup?.verified || !backup?.opened || !backup?.restorePassed || !backup?.manifestMatch || !backup?.fingerprintMatch || !backup?.migrationMatch) return 'VERIFIED_BACKUP_REQUIRED'
  if (backup.ageHours > 24) return 'VERIFIED_BACKUP_TOO_OLD'
  return 'READY'
}

const verified = { verified: true, opened: true, restorePassed: true, manifestMatch: true, fingerprintMatch: true, migrationMatch: true }
assert.equal(decision({ status: 'BACKUP_RECOMMENDED', backup: { ...verified, ageHours: 25 } }), 'VERIFIED_BACKUP_TOO_OLD')
assert.equal(decision({ status: 'HEALTHY', backup: { ...verified, ageHours: 2 } }), 'READY')
assert.equal(decision({ status: 'DATABASE_RECOVERY_REQUIRED', recoveryRequired: true, backup: { ...verified, ageHours: 2 } }), 'DATABASE_NOT_HEALTHY')
assert.equal(decision({ status: 'BACKUP_RECOMMENDED', backup: { ...verified, restorePassed: false, ageHours: 25 } }), 'VERIFIED_BACKUP_REQUIRED')

console.log('Guarded UI backup preflight ordering security regression passed')
