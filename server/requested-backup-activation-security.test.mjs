import assert from 'node:assert/strict'
import { mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseOperationCoordinator } from './database-operation-coordinator.ts'
import { RequestedBackupActivationControl } from './requested-backup-activation-control.ts'

const previousLiveSha = '1'.repeat(40)
const targetSha = '2'.repeat(40)
const request = { id: 'request-1', state: 'pending', category: 'manual', requestedAt: '2026-11-06T00:00:00.000Z', requestedBy: { userId: 'manager-1', displayName: 'Manager' }, instruction: 'verified backup' }
const input = { previousLiveSha, targetSha, targetBranch: 'codex/local-ui-security', approvalManifestSha256: 'a'.repeat(64), canonicalIdentitySha256: 'b'.repeat(64), canonicalStoreId: 'store-1', request, requestAuditVerified: true }
const fixture = async (clock = { value: new Date('2026-11-06T00:00:00.000Z') }) => {
  const root = await mkdtemp(join(tmpdir(), 'andalucia-maintenance-security-'))
  const coordinator = new DatabaseOperationCoordinator(root, { now: () => clock.value })
  const control = new RequestedBackupActivationControl(coordinator, () => clock.value)
  const authorization = await control.prepare(input)
  return { root, coordinator, control, authorization, clock }
}

// Trusted manager request and exact source bindings are mandatory.
const forgedRoot = await mkdtemp(join(tmpdir(), 'andalucia-forged-'))
await assert.rejects(() => new RequestedBackupActivationControl(new DatabaseOperationCoordinator(forgedRoot)).prepare({ ...input, requestAuditVerified: false }), /REQUESTED_BACKUP_AUTHENTICATED_REQUEST_INVALID/)

// Tampering with durable journal evidence is detected before any claim.
{
  const { coordinator, authorization } = await fixture()
  const path = coordinator.maintenancePath(authorization.authorizationId)
  const forged = JSON.parse(await readFile(path, 'utf8')); forged.targetSha = '3'.repeat(40)
  await writeFile(path, JSON.stringify(forged), 'utf8')
  await assert.rejects(() => coordinator.readCanonicalMaintenanceAuthorization(authorization.authorizationId), /CANONICAL_MAINTENANCE_AUTHORIZATION_TAMPERED/)
}

// The authenticated request itself is atomically single-use, even if the authorization record is deleted.
{
  const root = await mkdtemp(join(tmpdir(), 'andalucia-request-single-use-'))
  const coordinator = new DatabaseOperationCoordinator(root)
  const control = new RequestedBackupActivationControl(coordinator)
  const attempts = await Promise.allSettled([control.prepare(input), control.prepare(input)])
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1)
  const accepted = attempts.find(item => item.status === 'fulfilled').value
  await unlink(coordinator.maintenancePath(accepted.authorizationId))
  await assert.rejects(() => control.prepare(input), /CANONICAL_MAINTENANCE_REQUEST_ALREADY_AUTHORIZED/)
}

// Request/backup identity mismatch cannot be bound.
{
  const { control, authorization } = await fixture()
  await assert.rejects(() => control.bindVerifiedBackup(authorization.authorizationId, { request: { ...request, state: 'completed', backupId: 'wrong' }, backupId: 'backup-1', backupVerified: true, restoreReady: true }), /REQUESTED_BACKUP_REQUEST_BINDING_MISMATCH/)
}

// Expired authorization fails closed.
{
  const { control, authorization, clock } = await fixture()
  clock.value = new Date('2026-11-06T02:00:00.000Z')
  await assert.rejects(() => control.backupFailed(authorization.authorizationId, 'expired'), /CANONICAL_MAINTENANCE_AUTHORIZATION_EXPIRED/)
}

const verified = async () => {
  const value = await fixture()
  const completed = { ...request, state: 'completed', backupId: 'backup-1' }
  await value.control.bindVerifiedBackup(value.authorization.authorizationId, { request: completed, backupId: 'backup-1', backupVerified: true, restoreReady: true })
  return value
}

// Atomic claim permits exactly one concurrent target activation and blocks replay.
{
  const { control, authorization } = await verified()
  const claims = await Promise.allSettled([control.claimTarget(authorization.authorizationId), control.claimTarget(authorization.authorizationId)])
  assert.equal(claims.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(claims.filter(item => item.status === 'rejected').length, 1)
  await assert.rejects(() => control.claimTarget(authorization.authorizationId), /CANONICAL_MAINTENANCE_STATE_INVALID/)
}

// Backup and target failures authorize only a single previous-SHA recovery transition.
{
  const { control, authorization } = await fixture()
  await control.backupFailed(authorization.authorizationId, 'backup failed')
  const recovery = await control.claimRecovery(authorization.authorizationId)
  assert.equal(recovery.previousLiveSha, previousLiveSha)
  assert.equal((await control.recoveryHealthy(authorization.authorizationId)).state, 'RECOVERY_HEALTHY')
  await assert.rejects(() => control.claimRecovery(authorization.authorizationId), /CANONICAL_MAINTENANCE_STATE_INVALID/)
}
{
  const { control, authorization } = await verified()
  await control.claimTarget(authorization.authorizationId)
  await control.targetFailed(authorization.authorizationId, 'startup failed')
  await control.claimRecovery(authorization.authorizationId)
  assert.equal((await control.recoveryFailed(authorization.authorizationId, 'recovery health failed')).state, 'RECOVERY_FAILED')
  await assert.rejects(() => control.claimRecovery(authorization.authorizationId), /CANONICAL_MAINTENANCE_STATE_INVALID/)
}

// The deployment path uses the protected journal and keeps ordinary startup available.
const [orchestrator, preflight, activation, startup, resolver] = await Promise.all([
  readFile('deployment/windows/Invoke-AndaluciaRequestedBackupUiActivation.ps1', 'utf8'), readFile('deployment/windows/Test-AndaluciaGuardedUiActivation.ps1', 'utf8'),
  readFile('deployment/windows/Invoke-AndaluciaApprovedUiActivation.ps1', 'utf8'), readFile('deployment/windows/Start-AndaluciaGuardedApplication.ps1', 'utf8'), readFile('deployment/windows/Resolve-AndaluciaApprovedSource.ps1', 'utf8'),
])
for (const source of [orchestrator, preflight, activation]) {
  assert.doesNotMatch(source, /StoppedRuntimeEvidenceSha256|YES_I_APPROVE_ONE_GUARDED_REQUESTED_BACKUP_ACTIVATION_WINDOW|\.consumed\.json/)
  assert.match(source, /MaintenanceAuthorizationId/)
}
assert.match(orchestrator, /db:backup:job -- requested/)
assert.doesNotMatch(orchestrator, /db:backup:job -- daily/)
assert.match(orchestrator, /Invoke-GuardedPreviousRuntimeRecovery/)
assert.match(startup, /RecoveryAuthorizationId/)
assert.match(resolver, /approved_journal_bound_recovery/)
assert.match(resolver, /inspect-recovery-source/)

console.log(JSON.stringify({ status: 'PASS', suite: 'requested-backup-activation-security', behavioralCases: 10, productionDataTouched: false }, null, 2))
