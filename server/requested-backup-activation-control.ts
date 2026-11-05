import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseOperationCoordinator, type CanonicalMaintenanceAuthorization, type CanonicalMaintenanceState } from './database-operation-coordinator.js'

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const fileSha256 = async (path: string) => sha256(await readFile(path))
const json = async <T>(path: string) => JSON.parse(await readFile(path, 'utf8')) as T
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const requestBinding = (request: any) => sha256(JSON.stringify({ id: request.id, category: request.category, requestedAt: request.requestedAt, requestedBy: request.requestedBy, instruction: request.instruction }))
const fail = (code: string): never => { throw new Error(code) }

export class RequestedBackupActivationControl {
  constructor(readonly coordinator: DatabaseOperationCoordinator, readonly now = () => new Date()) {}

  async prepare(input: {
    previousLiveSha: string; targetSha: string; targetBranch: string; approvalManifestSha256: string
    canonicalIdentitySha256: string; canonicalStoreId: string; request: any; requestAuditVerified: boolean
  }) {
    if (!input.requestAuditVerified || input.request?.state !== 'pending' || input.request?.category !== 'manual' || !input.request?.requestedBy?.userId || !input.request?.requestedBy?.displayName) fail('REQUESTED_BACKUP_AUTHENTICATED_REQUEST_INVALID')
    if (!/^[0-9a-f]{40}$/i.test(input.previousLiveSha) || !/^[0-9a-f]{40}$/i.test(input.targetSha)) fail('REQUESTED_BACKUP_SOURCE_SHA_INVALID')
    return this.coordinator.createCanonicalMaintenanceAuthorization({
      previousLiveSha: input.previousLiveSha.toLowerCase(), targetSha: input.targetSha.toLowerCase(), targetBranch: input.targetBranch,
      approvalManifestSha256: input.approvalManifestSha256, canonicalIdentitySha256: input.canonicalIdentitySha256,
      canonicalStoreId: input.canonicalStoreId, schema: '027', databaseStatus: 'HEALTHY', migrationRequired: false, recoveryRequired: false, requestId: input.request.id,
      requestSha256: requestBinding(input.request), requestedBy: input.request.requestedBy,
      expiresAt: new Date(this.now().getTime() + 90 * 60_000).toISOString(),
    })
  }

  async bindVerifiedBackup(authorizationId: string, input: { request: any; backupId: string; backupVerified: boolean; restoreReady: boolean }) {
    const current = await this.coordinator.readCanonicalMaintenanceAuthorization(authorizationId)
    if (current.state !== 'AUTHORIZED') fail(`REQUESTED_BACKUP_BIND_STATE_INVALID:${current.state}`)
    if (input.request?.id !== current.requestId || input.request?.state !== 'completed' || input.request?.category !== 'manual' || input.request?.backupId !== input.backupId || requestBinding(input.request) !== current.requestSha256) fail('REQUESTED_BACKUP_REQUEST_BINDING_MISMATCH')
    if (!input.backupVerified || !input.restoreReady) fail('REQUESTED_BACKUP_VERIFICATION_OR_RESTORE_READINESS_FAILED')
    return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['AUTHORIZED'], 'BACKUP_VERIFIED', { backupId: input.backupId })
  }

  read(authorizationId: string) { return this.coordinator.readCanonicalMaintenanceAuthorization(authorizationId) }
  claimTarget(authorizationId: string) { return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['BACKUP_VERIFIED'], 'TARGET_CLAIMED') }
  targetHealthy(authorizationId: string) { return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['TARGET_CLAIMED'], 'TARGET_HEALTHY') }
  targetFailed(authorizationId: string, failure: string) { return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['TARGET_CLAIMED'], 'TARGET_FAILED', { failure: failure.slice(0, 500) }) }
  backupFailed(authorizationId: string, failure: string) { return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['AUTHORIZED'], 'BACKUP_FAILED', { failure: failure.slice(0, 500) }) }
  claimRecovery(authorizationId: string) { return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['BACKUP_FAILED', 'TARGET_FAILED'], 'RECOVERY_CLAIMED') }
  recoveryHealthy(authorizationId: string) { return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['RECOVERY_CLAIMED'], 'RECOVERY_HEALTHY') }
  recoveryFailed(authorizationId: string, failure: string) { return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['RECOVERY_CLAIMED'], 'RECOVERY_FAILED', { failure: failure.slice(0, 500) }) }
}

type ApprovalManifest = { activeSourceSha: string; previousLiveSha: string; branch: string; reviewedCheckpointSha?: string; controlCommitSha: string }
type StoreIdentity = { role: string; databaseDirectory: string; storeId: string }

const paths = (projectRoot: string) => ({
  approval: join(projectRoot, '.runtime', 'andalucia-local-ui-approval.json'),
  identity: join(projectRoot, '.data', 'andalucia-store-identity.json'),
  requests: join(projectRoot, '.backups', '.db2', 'requests'),
  audit: join(projectRoot, '.backups', '.db2', 'audit.jsonl'),
  operations: join(projectRoot, '.backups', '.db2', 'operations'),
})

const requestById = async (projectRoot: string, requestId?: string) => {
  const root = paths(projectRoot).requests
  const names = existsSync(root) ? (await readdir(root)).filter(name => name.endsWith('.json')) : []
  const requests = await Promise.all(names.map(name => json<any>(join(root, name)).catch(() => null)))
  const matches = requests.filter(item => item && (requestId ? item.id === requestId : item.state === 'pending'))
  if (matches.length !== 1) fail(`REQUESTED_BACKUP_REQUEST_COUNT_INVALID:${matches.length}`)
  return matches[0]
}

const requestAuditVerified = async (projectRoot: string, request: any) => {
  const auditPath = paths(projectRoot).audit
  if (!existsSync(auditPath)) return false
  return (await readFile(auditPath, 'utf8')).split(/\r?\n/).filter(Boolean).some(line => {
    try { const item = JSON.parse(line); return item.action === 'manual_backup_requested' && item.details?.requestId === request.id && item.actor?.source === 'authenticated_user' && item.actor?.userId === request.requestedBy.userId && item.actor?.displayName === request.requestedBy.displayName } catch { return false }
  })
}

const currentBindings = async (projectRoot: string) => {
  const p = paths(projectRoot)
  const approval = await json<ApprovalManifest>(p.approval)
  const identity = await json<StoreIdentity>(p.identity)
  const canonicalData = resolve(projectRoot, '.data', 'postgres')
  if (identity.role !== 'canonical' || resolve(identity.databaseDirectory) !== canonicalData) fail('REQUESTED_BACKUP_CANONICAL_IDENTITY_INVALID')
  return { approval, identity, approvalSha: await fileSha256(p.approval), identitySha: await fileSha256(p.identity) }
}

const assertBindings = async (projectRoot: string, record: CanonicalMaintenanceAuthorization) => {
  const bindings = await currentBindings(projectRoot)
  if (bindings.approvalSha !== record.approvalManifestSha256 || bindings.identitySha !== record.canonicalIdentitySha256 || bindings.identity.storeId !== record.canonicalStoreId || bindings.approval.activeSourceSha !== record.targetSha || bindings.approval.previousLiveSha !== record.previousLiveSha) fail('REQUESTED_BACKUP_PROTECTED_BINDING_MISMATCH')
  return bindings
}

const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined }
const required = (name: string) => arg(name) || fail(`ARGUMENT_REQUIRED:${name}`)

export async function runRequestedBackupActivationControl(command: string, argv = process.argv) {
  void argv
  const projectRoot = resolve(required('--project-root'))
  const coordinator = new DatabaseOperationCoordinator(paths(projectRoot).operations)
  const control = new RequestedBackupActivationControl(coordinator)
  if (command === 'prepare') {
    const expectedSha = required('--expected-sha').toLowerCase()
    const bindings = await currentBindings(projectRoot)
    const head = git(projectRoot, 'rev-parse', 'HEAD').toLowerCase(); const branch = git(projectRoot, 'branch', '--show-current')
    if (head !== expectedSha || bindings.approval.activeSourceSha !== expectedSha || bindings.approval.controlCommitSha !== expectedSha || bindings.approval.branch !== branch) fail('REQUESTED_BACKUP_APPROVED_SOURCE_MISMATCH')
    const request = await requestById(projectRoot)
    const health = await (await fetch('http://127.0.0.1:3001/api/health')).json() as any
    if (!health.ok || health.application.sha !== bindings.approval.previousLiveSha || health.database.status !== 'HEALTHY' || health.database.migrationVersion !== '027' || health.database.migrationRequired || health.database.recoveryRequired || health.database.storeId !== bindings.identity.storeId) fail('REQUESTED_BACKUP_PRE_SHUTDOWN_HEALTH_INVALID')
    return control.prepare({ previousLiveSha: health.application.sha, targetSha: expectedSha, targetBranch: branch, approvalManifestSha256: bindings.approvalSha, canonicalIdentitySha256: bindings.identitySha, canonicalStoreId: bindings.identity.storeId, request, requestAuditVerified: await requestAuditVerified(projectRoot, request) })
  }
  const authorizationId = required('--authorization-id')
  const record = await control.read(authorizationId)
  await assertBindings(projectRoot, record)
  if (command === 'bind-backup') {
    const request = await requestById(projectRoot, record.requestId)
    const backupId = String(request.backupId || '')
    if (!backupId || basename(backupId) !== backupId) fail('REQUESTED_BACKUP_ID_INVALID')
    const folder = join(projectRoot, '.backups', backupId)
    const metadata = await json<any>(join(folder, 'backup-metadata.json'))
    const restore = await json<any>(join(folder, 'restore-test.json'))
    return control.bindVerifiedBackup(authorizationId, { request, backupId, backupVerified: metadata.backupId === backupId && metadata.category === 'manual' && metadata.verificationStatus === 'VERIFIED' && metadata.openTestStatus === 'PASS' && metadata.preflightStatus === 'READY', restoreReady: restore.backupId === backupId && restore.status === 'RESTORE_TEST_PASSED' && restore.manifestMatch && restore.fingerprintMatch && restore.migrationMatch && restore.preflightStatus === 'READY' })
  }
  const transitions: Record<string, () => Promise<CanonicalMaintenanceAuthorization>> = {
    'inspect': async () => record,
    'inspect-target': async () => { if (record.state !== 'BACKUP_VERIFIED') fail(`REQUESTED_BACKUP_TARGET_NOT_READY:${record.state}`); return record },
    'claim-target': () => control.claimTarget(authorizationId),
    'target-healthy': () => control.targetHealthy(authorizationId),
    'target-failed': () => control.targetFailed(authorizationId, arg('--failure') || 'TARGET_START_FAILED'),
    'backup-failed': () => control.backupFailed(authorizationId, arg('--failure') || 'BACKUP_FAILED'),
    'claim-recovery': () => control.claimRecovery(authorizationId),
    'recovery-healthy': () => control.recoveryHealthy(authorizationId),
    'recovery-failed': () => control.recoveryFailed(authorizationId, arg('--failure') || 'RECOVERY_FAILED'),
    'inspect-recovery-source': async () => {
      if (record.state !== 'RECOVERY_CLAIMED') fail(`REQUESTED_BACKUP_RECOVERY_NOT_CLAIMED:${record.state}`)
      const sourceRoot = resolve(required('--source-root'))
      if (git(sourceRoot, 'rev-parse', 'HEAD').toLowerCase() !== record.previousLiveSha || git(sourceRoot, 'status', '--porcelain', '--untracked-files=no')) fail('REQUESTED_BACKUP_RECOVERY_SOURCE_INVALID')
      return record
    },
  }
  const transition = transitions[command]
  if (!transition) fail(`REQUESTED_BACKUP_CONTROL_COMMAND_INVALID:${command}`)
  return transition()
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || '')) {
  runRequestedBackupActivationControl(process.argv[2] || '').then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
}
