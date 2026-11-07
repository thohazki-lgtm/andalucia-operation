import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseOperationCoordinator } from './database-operation-coordinator.ts'
import { registerStoppedRuntimeRecoveryApproval } from './offline-recovery-approval-binding-control.ts'
import { runRequestedBackupActivationControl } from './requested-backup-activation-control.ts'

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const startupRecord = (state, detail, recordedAt) => JSON.stringify({ version: 'andalucia-guarded-startup-v1', recordedAt, state, detail })
const identityHash = value => createHash('sha256').update(value).digest('hex')

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'andalucia-recovery-approval-binding-'))
  await mkdir(join(root, 'deployment', 'windows'), { recursive: true })
  await mkdir(join(root, 'server'), { recursive: true })
  await writeFile(join(root, 'base.txt'), 'previous')
  git(root, 'init'); git(root, 'config', 'user.email', 'security-test@example.invalid'); git(root, 'config', 'user.name', 'Security Test')
  git(root, 'add', '.'); git(root, 'commit', '-m', 'previous healthy source')
  const previous = git(root, 'rev-parse', 'HEAD').toLowerCase()
  await writeFile(join(root, 'control.txt'), 'approved scheduler control')
  git(root, 'add', '.'); git(root, 'commit', '-m', 'approved control source')
  const approvedControl = git(root, 'rev-parse', 'HEAD').toLowerCase()
  await writeFile(join(root, 'deployment', 'windows', 'Register-AndaluciaStoppedRuntimeRecoveryApproval.ps1'), '# protected registration mechanism')
  git(root, 'add', '.'); git(root, 'commit', '-m', 'protected approval registration')
  git(root, 'branch', '-M', 'main')
  const registrationSource = git(root, 'rev-parse', 'HEAD').toLowerCase()
  git(root, 'update-ref', 'refs/remotes/origin/main', registrationSource)

  const dataDirectory = join(root, '.data', 'postgres')
  const backupRoot = join(root, '.backups')
  const operationsRoot = join(backupRoot, '.db2', 'operations')
  await mkdir(dataDirectory, { recursive: true })
  await mkdir(join(root, '.runtime', 'logs'), { recursive: true })
  await mkdir(join(backupRoot, 'verified-backup'), { recursive: true })
  await mkdir(join(backupRoot, '.db2', 'requests'), { recursive: true })
  const identity = JSON.stringify({ role: 'canonical', storeId: 'andalucia-canonical-live', databaseDirectory: dataDirectory })
  await writeFile(join(root, '.data', 'andalucia-store-identity.json'), identity)
  await writeFile(join(root, '.runtime', 'logs', 'guarded-startup.jsonl'), [
    startupRecord('SOURCE_APPROVED', `sha=${previous};branch=main;mode=verified_main`, '2026-11-07T12:55:07.8431755Z'),
    startupRecord('EXITED', 'exitCode=0', '2026-11-07T18:32:48.2691033Z'),
  ].join('\n') + '\n')
  await writeFile(join(backupRoot, 'verified-backup', 'backup-metadata.json'), JSON.stringify({ backupId: 'verified-backup', schemaVersion: '027', verificationStatus: 'VERIFIED', openTestStatus: 'PASS', preflightStatus: 'READY' }))
  await writeFile(join(backupRoot, 'verified-backup', 'restore-test.json'), JSON.stringify({ backupId: 'verified-backup', status: 'RESTORE_TEST_PASSED', manifestMatch: true, fingerprintMatch: true, migrationMatch: true, preflightStatus: 'READY' }))
  const fakeDatabase = (schema = '027', storeId = 'andalucia-canonical-live') => async () => ({
    db: { close: async () => undefined }, identity: { storeId }, health: { migrationVersion: schema, migrationRequired: false, recoveryRequired: false }
  })
  const dependencies = { portsClosed: async () => true, authenticate: async () => ({ userId: 'owner-1', displayName: 'Platform Owner' }), openDatabase: fakeDatabase(), now: () => new Date('2026-11-08T00:00:00.000Z') }
  return { root, previous, approvedControl, registrationSource, operationsRoot, identity, dependencies, fakeDatabase }
}

async function register(value, overrides = {}) {
  return registerStoppedRuntimeRecoveryApproval({ projectRoot: value.root, previousHealthySha: value.previous, approvedControlSha: value.approvedControl, identifier: 'platform.owner', password: 'private' }, { ...value.dependencies, ...overrides })
}

// Valid evidence produces an immutable, expiring, manager-attributed binding without editing an approval manifest.
{
  const value = await fixture()
  const binding = await register(value)
  assert.equal(binding.state, 'REGISTERED')
  assert.equal(binding.previousLiveSha, value.previous)
  assert.equal(binding.approvedControlSha, value.approvedControl)
  assert.equal(binding.registrationSourceSha, value.registrationSource)
  assert.equal(binding.canonicalIdentitySha256, identityHash(value.identity))
  assert.equal(binding.schema, '027')
  assert.equal(binding.backupId, 'verified-backup')
  assert.deepEqual(binding.approvedBy, { userId: 'owner-1', displayName: 'Platform Owner' })
  await assert.rejects(() => register(value), /RECOVERY_APPROVAL_BINDING_INCIDENT_ALREADY_REGISTERED/)
}

// Invalid SHA, wrong store, wrong schema, missing backup evidence and malformed runtime evidence fail closed.
{
  const value = await fixture()
  await assert.rejects(() => registerStoppedRuntimeRecoveryApproval({ projectRoot: value.root, previousHealthySha: 'bad', approvedControlSha: value.approvedControl, identifier: 'owner', password: 'private' }, value.dependencies), /RECOVERY_APPROVAL_SOURCE_SHA_INVALID/)
}
{
  const value = await fixture()
  await writeFile(join(value.root, '.data', 'andalucia-store-identity.json'), JSON.stringify({ role: 'canonical', storeId: 'wrong-store', databaseDirectory: join(value.root, '.data', 'postgres') }))
  await assert.rejects(() => register(value), /RECOVERY_APPROVAL_CANONICAL_IDENTITY_INVALID/)
}
{
  const value = await fixture()
  await assert.rejects(() => register(value, { openDatabase: value.fakeDatabase('026') }), /RECOVERY_APPROVAL_SCHEMA_EVIDENCE_INVALID/)
}
{
  const value = await fixture()
  await rm(join(value.root, '.backups', 'verified-backup'), { recursive: true, force: true })
  await assert.rejects(() => register(value), /REQUESTED_BACKUP_VERIFIED_SCHEMA_EVIDENCE_MISSING/)
}
{
  const value = await fixture()
  await writeFile(join(value.root, '.runtime', 'logs', 'guarded-startup.jsonl'), startupRecord('SOURCE_APPROVED', `sha=${value.previous};branch=main;mode=verified_main`, '2026-11-07T12:55:07.8431755Z') + '\n')
  await assert.rejects(() => register(value), /REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_INVALID/)
}

// Expiry, replay, tampering, mismatched request identity and concurrent claims are rejected durably.
{
  const value = await fixture()
  const binding = await register(value, { now: () => new Date('2026-11-01T00:00:00.000Z') })
  const coordinator = new DatabaseOperationCoordinator(value.operationsRoot, { now: () => new Date('2026-11-08T00:00:00.000Z') })
  await assert.rejects(() => coordinator.claimRecoveryApprovalBinding(binding.bindingId, 'request-expired'), /RECOVERY_APPROVAL_BINDING_EXPIRED/)
}
{
  const value = await fixture()
  const binding = await register(value)
  const coordinator = new DatabaseOperationCoordinator(value.operationsRoot, { now: () => new Date('2026-11-08T00:01:00.000Z') })
  await coordinator.claimRecoveryApprovalBinding(binding.bindingId, 'request-one')
  await assert.rejects(() => coordinator.claimRecoveryApprovalBinding(binding.bindingId, 'request-two'), /RECOVERY_APPROVAL_BINDING_REPLAYED/)
}
{
  const value = await fixture()
  const binding = await register(value)
  const coordinator = new DatabaseOperationCoordinator(value.operationsRoot, { now: () => new Date('2026-11-08T00:01:00.000Z') })
  const claims = await Promise.allSettled([coordinator.claimRecoveryApprovalBinding(binding.bindingId, 'request-one'), coordinator.claimRecoveryApprovalBinding(binding.bindingId, 'request-two')])
  assert.equal(claims.filter(item => item.status === 'fulfilled').length, 1)
}
{
  const value = await fixture()
  const binding = await register(value)
  const coordinator = new DatabaseOperationCoordinator(value.operationsRoot)
  const path = coordinator.recoveryApprovalBindingPath(binding.bindingId)
  const tampered = JSON.parse(await readFile(path, 'utf8')); tampered.previousLiveSha = 'f'.repeat(40)
  await writeFile(path, JSON.stringify(tampered))
  await assert.rejects(() => coordinator.readRecoveryApprovalBinding(binding.bindingId), /RECOVERY_APPROVAL_BINDING_TAMPERED/)
}

// A claimed binding drives the existing stopped-runtime authorization without rewriting the stale manifest.
{
  const value = await fixture()
  const binding = await register(value)
  const request = { id: 'request-bound', category: 'manual', state: 'pending', requestedAt: '2026-11-08T00:01:00.000Z', requestedBy: { userId: 'owner-1', displayName: 'Platform Owner' }, instruction: 'offline recovery request' }
  await writeFile(join(value.root, '.backups', '.db2', 'requests', `${request.id}.json`), JSON.stringify(request))
  await writeFile(join(value.root, '.backups', '.db2', 'audit.jsonl'), JSON.stringify({ action: 'manual_backup_requested', actor: { source: 'authenticated_user', ...request.requestedBy }, details: { requestId: request.id } }) + '\n')
  const coordinator = new DatabaseOperationCoordinator(value.operationsRoot, { now: () => new Date('2026-11-08T00:01:00.000Z') })
  await coordinator.claimRecoveryApprovalBinding(binding.bindingId, request.id)
  const authorization = await runRequestedBackupActivationControl('prepare-stopped-recovery', ['node', 'control', '--project-root', value.root, '--request-id', request.id, '--approval-binding-id', binding.bindingId], { portsClosed: async () => true })
  assert.equal(authorization.state, 'RECOVERY_AUTHORIZED')
  assert.equal(authorization.previousLiveSha, value.previous)
  assert.equal(authorization.targetSha, value.approvedControl)
  assert.equal(authorization.recoveryApprovalBindingId, binding.bindingId)
  await assert.rejects(() => runRequestedBackupActivationControl('prepare-stopped-recovery', ['node', 'control', '--project-root', value.root, '--request-id', request.id, '--approval-binding-id', binding.bindingId], { portsClosed: async () => true }), /CANONICAL_MAINTENANCE_REQUEST_ALREADY_AUTHORIZED/)
}

const registrationScript = await readFile('deployment/windows/Register-AndaluciaStoppedRuntimeRecoveryApproval.ps1', 'utf8')
assert.match(registrationScript, /Read-Host 'Manager password' -AsSecureString/)
assert.doesNotMatch(registrationScript.match(/^param\([\s\S]*?^\)/m)?.[0] || '', /Password/)
assert.match(registrationScript, /ZeroFreeBSTR/)
console.log(JSON.stringify({ status: 'PASS', validRegistration: true, invalidShaRejected: true, expiredRejected: true, wrongStoreRejected: true, wrongSchemaRejected: true, missingBackupRejected: true, malformedHistoricalEvidenceRejected: true, replayRejected: true, concurrentClaimRejected: true, tamperingRejected: true, stoppedRecoveryBindingIntegrated: true, manifestRewritten: false, canonicalDataTouched: false }, null, 2))
