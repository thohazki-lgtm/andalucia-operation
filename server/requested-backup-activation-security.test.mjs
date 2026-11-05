import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [orchestrator, preflight, activation] = await Promise.all([
  readFile('deployment/windows/Invoke-AndaluciaRequestedBackupUiActivation.ps1', 'utf8'),
  readFile('deployment/windows/Test-AndaluciaGuardedUiActivation.ps1', 'utf8'),
  readFile('deployment/windows/Invoke-AndaluciaApprovedUiActivation.ps1', 'utf8'),
])

assert.match(orchestrator, /YES_I_APPROVE_ONE_GUARDED_REQUESTED_BACKUP_ACTIVATION_WINDOW/)
assert.match(orchestrator, /pending\.Count -ne 1/)
assert.match(orchestrator, /REQUESTED_BACKUP_AUTHENTICATED_REQUEST_INVALID/)
assert.match(orchestrator, /VERIFIED_BACKUP_TOO_OLD:/)
assert.match(orchestrator, /Stop-AndaluciaGuardedApplication\.ps1/)
assert.match(orchestrator, /db:backup:job -- requested/)
assert.doesNotMatch(orchestrator, /db:backup:job -- daily/)
assert.match(orchestrator, /RESTORE_TEST_PASSED/)
assert.match(orchestrator, /manifestMatch/)
assert.match(orchestrator, /fingerprintMatch/)
assert.match(orchestrator, /migrationMatch/)
assert.match(orchestrator, /portsReleased=\$true/)
assert.match(orchestrator, /ownershipMarkerReleased=\$true/)
assert.match(orchestrator, /approvalManifestSha256/)
assert.match(orchestrator, /canonicalIdentitySha256/)
assert.match(orchestrator, /preShutdownDatabaseStoreId/)
assert.match(orchestrator, /preShutdownRuntimeBranch/)
assert.match(orchestrator, /AddMinutes\(10\)/)
assert.match(orchestrator, /Write-MaintenanceAudit 'FAILED'/)
assert.match(orchestrator, /FAIL_CLOSED_REQUIRES_EXISTING_GUARDED_RECOVERY_REVIEW;NO_AUTOMATIC_RETRY/)

assert.match(preflight, /READY_STOPPED_RUNTIME/)
assert.match(preflight, /STOPPED_RUNTIME_EVIDENCE_HASH_MISMATCH/)
assert.match(preflight, /STOPPED_RUNTIME_EVIDENCE_ALREADY_CONSUMED/)
assert.match(preflight, /STOPPED_RUNTIME_EVIDENCE_EXPIRED/)
assert.match(preflight, /STOPPED_RUNTIME_PRE_SHUTDOWN_HEALTH_STALE/)
assert.match(preflight, /STOPPED_RUNTIME_EVIDENCE_REQUEST_BINDING_MISMATCH/)
assert.match(preflight, /STOPPED_RUNTIME_EVIDENCE_BINDING_MISMATCH/)
assert.match(preflight, /STOPPED_RUNTIME_EVIDENCE_BACKUP_MISMATCH/)
assert.match(preflight, /STOPPED_RUNTIME_EXCLUSIVITY_NOT_VERIFIED/)
assert.match(preflight, /Invoke-RestMethod -Uri 'http:\/\/127\.0\.0\.1:3001\/api\/health'/)

assert.match(activation, /STOPPED_RUNTIME_EVIDENCE_CLAIM_FAILED/)
assert.match(activation, /FileMode\]::CreateNew/)
assert.match(activation, /state='START_ATTEMPTED'/)
assert.match(activation, /state = 'HEALTH_VERIFIED'/)
assert.match(activation, /if \(\$preflight\.status -ne 'READY_STOPPED_RUNTIME'\)/)

console.log(JSON.stringify({ status: 'PASS', suite: 'requested-backup-activation-security', productionDataTouched: false }, null, 2))
