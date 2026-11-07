import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { hashPassword, verifyPassword } from './auth-service.js'
import { AuthorizationService } from './authorization-service.js'
import { DatabaseBackupAdminService } from './database-backup-admin.js'
import { openVerifiedDatabase } from './database-protection.js'
import { runRequestedBackupActivationControl } from './requested-backup-activation-control.js'
import { DatabaseOperationCoordinator, type RecoveryApprovalBinding } from './database-operation-coordinator.js'

type OfflineManager = { userId: string; displayName: string }
type OfflineIssuerInput = { projectRoot: string; previousHealthySha: string; identifier: string; password: string; approvalBindingId?: string }
type OfflineIssuerResult = { requestId: string; authorizationId: string; previousLiveSha: string; targetSha: string; state: string }

const SHA = /^[0-9a-f]{40}$/i
const normalizeIdentifier = (value: string) => value.normalize('NFKC').trim().toLowerCase()
const fail = (code: string): never => { throw new Error(code) }
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const portOpen = (port: number) => new Promise<boolean>(resolveOpen => {
  const socket = createConnection({ host: '127.0.0.1', port })
  const done = (value: boolean) => { socket.destroy(); resolveOpen(value) }
  socket.setTimeout(750, () => done(false)); socket.once('connect', () => done(true)); socket.once('error', () => done(false))
})

export async function authenticateOfflineManager(db: PGlite, identifier: string, password: string): Promise<OfflineManager> {
  const normalized = normalizeIdentifier(identifier)
  if (!normalized || !password) fail('OFFLINE_RECOVERY_MANAGER_CREDENTIALS_REQUIRED')
  const row = (await db.query<any>(`select u.id,u.display_name,u.password_hash,u.status,u.must_change_password,
    case when u.staff_id is null then true else coalesce((select (c.metadata->>'eligibleForAssignments')::boolean from configuration_options c where c.group_key='employment_statuses' and c.value=s.employment_status_key),s.employment_status_key='active') end staff_eligible
    from user_accounts u left join staff s on s.id=u.staff_id where u.normalized_login_identifier=$1`, [normalized])).rows[0]
  const comparisonHash = row?.password_hash || await hashPassword('OfflineDummy2026')
  const valid = await verifyPassword(password, comparisonHash)
  if (!row || !valid || row.status !== 'active' || !row.staff_eligible || row.must_change_password) fail('OFFLINE_RECOVERY_MANAGER_AUTHENTICATION_FAILED')
  const authorization = await new AuthorizationService(db).authorizationForUser(row.id)
  if (!authorization.isOwner || !authorization.globalScope || !authorization.permissionKeys.includes('manage_platform')) fail('OFFLINE_RECOVERY_OWNER_AUTHORIZATION_REQUIRED')
  return { userId: row.id, displayName: row.display_name }
}

export async function issueOfflineRecoveryRequest(input: OfflineIssuerInput, dependencies: {
  portsClosed?: () => Promise<boolean>
  authenticate?: (db: PGlite, identifier: string, password: string) => Promise<OfflineManager>
} = {}): Promise<OfflineIssuerResult> {
  const projectRoot = resolve(input.projectRoot)
  const previousHealthySha = input.previousHealthySha.toLowerCase()
  if (!SHA.test(previousHealthySha)) fail('OFFLINE_RECOVERY_PREVIOUS_SHA_INVALID')
  const approvalPath = join(projectRoot, '.runtime', 'andalucia-local-ui-approval.json')
  const identityPath = join(projectRoot, '.data', 'andalucia-store-identity.json')
  const ownerMarker = join(projectRoot, '.runtime', 'canonical-owner.json')
  const backupRoot = join(projectRoot, '.backups')
  const operationsRoot = join(backupRoot, '.db2', 'operations')
  const issueLock = join(operationsRoot, 'offline-recovery-request.lock')
  const approval = JSON.parse(await readFile(approvalPath, 'utf8')) as { previousLiveSha?: string; activeSourceSha?: string }
  const identity = JSON.parse(await readFile(identityPath, 'utf8')) as { role?: string; storeId?: string; databaseDirectory?: string }
  const identitySha256 = sha256(await readFile(identityPath))
  const databaseDirectory = String(identity.databaseDirectory || '')
  const coordinator = new DatabaseOperationCoordinator(operationsRoot)
  let protectedBinding: RecoveryApprovalBinding | undefined
  if (input.approvalBindingId) {
    protectedBinding = await coordinator.readRecoveryApprovalBinding(input.approvalBindingId)
    if (protectedBinding.state !== 'REGISTERED' || protectedBinding.previousLiveSha !== previousHealthySha || protectedBinding.canonicalIdentitySha256 !== identitySha256 || protectedBinding.canonicalStoreId !== identity.storeId || protectedBinding.schema !== '027' || protectedBinding.targetBranch !== 'main') fail('OFFLINE_RECOVERY_APPROVAL_BINDING_INVALID')
  } else if (approval.previousLiveSha?.toLowerCase() !== previousHealthySha || !SHA.test(String(approval.activeSourceSha || ''))) fail('OFFLINE_RECOVERY_APPROVAL_BINDING_INVALID')
  if (identity.role !== 'canonical' || identity.storeId !== 'andalucia-canonical-live' || !databaseDirectory) fail('OFFLINE_RECOVERY_CANONICAL_IDENTITY_INVALID')
  if (existsSync(ownerMarker) || !await (dependencies.portsClosed || (async () => !(await portOpen(3001)) && !(await portOpen(5173))))()) fail('OFFLINE_RECOVERY_RUNTIME_NOT_EXCLUSIVE')
  const branch = execFileSync('git', ['-C', projectRoot, 'branch', '--show-current'], { encoding: 'utf8' }).trim()
  const dirty = execFileSync('git', ['-C', projectRoot, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()
  const head = execFileSync('git', ['-C', projectRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase()
  if (branch !== 'main' || dirty || (protectedBinding && protectedBinding.registrationSourceSha !== head)) fail('OFFLINE_RECOVERY_CONTROL_SOURCE_INVALID')
  await mkdir(operationsRoot, { recursive: true })
  const acquireLock = async () => { try { return await open(issueLock, 'wx') } catch { return fail('OFFLINE_RECOVERY_REQUEST_CONCURRENT') } }
  const lock = await acquireLock()
  try {
    const guarded = await openVerifiedDatabase({ dataDirectory: databaseDirectory, role: 'canonical', requiredVersion: '027', backupRoot })
    let actor: OfflineManager
    try {
      if (guarded.identity.storeId !== identity.storeId || guarded.health.migrationVersion !== '027' || guarded.health.migrationRequired || guarded.health.recoveryRequired) fail('OFFLINE_RECOVERY_DATABASE_EVIDENCE_INVALID')
      actor = await (dependencies.authenticate || authenticateOfflineManager)(guarded.db, input.identifier, input.password)
    } finally { await guarded.db.close() }
    const request = await new DatabaseBackupAdminService(backupRoot, databaseDirectory, '027').requestManualBackup(actor)
    if (protectedBinding) await coordinator.claimRecoveryApprovalBinding(protectedBinding.bindingId, request.id)
    const bindingArgs = protectedBinding ? ['--approval-binding-id', protectedBinding.bindingId] : []
    const authorization = await runRequestedBackupActivationControl('prepare-stopped-recovery', ['node', 'offline-control', '--project-root', projectRoot, '--request-id', request.id, ...bindingArgs], { portsClosed: async () => true }) as any
    if (authorization.previousLiveSha !== previousHealthySha || authorization.requestId !== request.id || authorization.canonicalStoreId !== identity.storeId || authorization.schema !== '027' || authorization.state !== 'RECOVERY_AUTHORIZED') fail('OFFLINE_RECOVERY_AUTHORIZATION_BINDING_INVALID')
    return { requestId: request.id, authorizationId: authorization.authorizationId, previousLiveSha: authorization.previousLiveSha, targetSha: authorization.targetSha, state: authorization.state }
  } finally {
    await lock.close(); await unlink(issueLock).catch(() => undefined)
  }
}

async function readStdin() {
  let value = ''
  for await (const chunk of process.stdin) value += String(chunk)
  const parsed = JSON.parse(value) as { identifier?: string; password?: string }
  return { identifier: String(parsed.identifier || ''), password: String(parsed.password || '') }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined }
  const projectRoot = arg('--project-root') || fail('ARGUMENT_REQUIRED:--project-root')
  const previousHealthySha = arg('--previous-healthy-sha') || fail('ARGUMENT_REQUIRED:--previous-healthy-sha')
  const approvalBindingId = arg('--approval-binding-id')
  readStdin().then(credentials => issueOfflineRecoveryRequest({ projectRoot, previousHealthySha, approvalBindingId, ...credentials })).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 })
}
