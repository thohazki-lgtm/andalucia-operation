import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { createConnection } from 'node:net'
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
      authorizationMode: 'live_requested_backup',
      approvalManifestSha256: input.approvalManifestSha256, canonicalIdentitySha256: input.canonicalIdentitySha256,
      canonicalStoreId: input.canonicalStoreId, schema: '027', databaseStatus: 'HEALTHY', migrationRequired: false, recoveryRequired: false, requestId: input.request.id,
      requestSha256: requestBinding(input.request), requestedBy: input.request.requestedBy,
      expiresAt: new Date(this.now().getTime() + 90 * 60_000).toISOString(),
    })
  }

  async prepareStoppedRecovery(input: {
    previousLiveSha: string; targetSha: string; targetBranch: string; approvalManifestSha256: string
    canonicalIdentitySha256: string; canonicalStoreId: string; request: any; requestAuditVerified: boolean
    historicalRuntimeEvidenceSha256: string; schemaEvidenceSha256: string
  }) {
    if (!input.requestAuditVerified || input.request?.state !== 'pending' || input.request?.category !== 'manual' || !input.request?.requestedBy?.userId || !input.request?.requestedBy?.displayName) fail('REQUESTED_BACKUP_AUTHENTICATED_REQUEST_INVALID')
    if (!/^[0-9a-f]{40}$/i.test(input.previousLiveSha) || !/^[0-9a-f]{40}$/i.test(input.targetSha)) fail('REQUESTED_BACKUP_SOURCE_SHA_INVALID')
    if (!/^[0-9a-f]{64}$/i.test(input.historicalRuntimeEvidenceSha256) || !/^[0-9a-f]{64}$/i.test(input.schemaEvidenceSha256)) fail('REQUESTED_BACKUP_HISTORICAL_EVIDENCE_INVALID')
    return this.coordinator.createCanonicalMaintenanceAuthorization({
      previousLiveSha: input.previousLiveSha.toLowerCase(), targetSha: input.targetSha.toLowerCase(), targetBranch: input.targetBranch,
      authorizationMode: 'stopped_runtime_recovery', approvalManifestSha256: input.approvalManifestSha256,
      canonicalIdentitySha256: input.canonicalIdentitySha256, canonicalStoreId: input.canonicalStoreId,
      schema: '027', databaseStatus: 'HEALTHY', migrationRequired: false, recoveryRequired: false,
      requestId: input.request.id, requestSha256: requestBinding(input.request), requestedBy: input.request.requestedBy,
      historicalRuntimeEvidenceSha256: input.historicalRuntimeEvidenceSha256, schemaEvidenceSha256: input.schemaEvidenceSha256,
      expiresAt: new Date(this.now().getTime() + 15 * 60_000).toISOString(),
    }, 'RECOVERY_AUTHORIZED')
  }

  async bindVerifiedBackup(authorizationId: string, input: { request: any; backupId: string; backupVerified: boolean; restoreReady: boolean }) {
    const current = await this.coordinator.readCanonicalMaintenanceAuthorization(authorizationId)
    if (current.authorizationMode !== 'live_requested_backup') fail('REQUESTED_BACKUP_AUTHORIZATION_MODE_INVALID')
    if (current.state !== 'AUTHORIZED') fail(`REQUESTED_BACKUP_BIND_STATE_INVALID:${current.state}`)
    if (input.request?.id !== current.requestId || input.request?.state !== 'completed' || input.request?.category !== 'manual' || input.request?.backupId !== input.backupId || requestBinding(input.request) !== current.requestSha256) fail('REQUESTED_BACKUP_REQUEST_BINDING_MISMATCH')
    if (!input.backupVerified || !input.restoreReady) fail('REQUESTED_BACKUP_VERIFICATION_OR_RESTORE_READINESS_FAILED')
    return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['AUTHORIZED'], 'BACKUP_VERIFIED', { backupId: input.backupId })
  }

  async prepareCompletedSchema028Migration(input: {
    previousLiveSha: string; targetSha: string; canonicalIdentitySha256: string; canonicalStoreId: string
    migrationAuthorizationId: string; migrationAuthorizationSha256: string; backupId: string
    requestedBy: { userId: string; displayName: string }; historicalRuntimeEvidenceSha256: string
    schemaEvidenceSha256: string; expiresAt: string
  }) {
    if (!/^[0-9a-f]{40}$/i.test(input.previousLiveSha) || !/^[0-9a-f]{40}$/i.test(input.targetSha) || !/^[0-9a-f]{64}$/i.test(input.migrationAuthorizationSha256) || !/^[0-9a-f]{64}$/i.test(input.historicalRuntimeEvidenceSha256) || !/^[0-9a-f]{64}$/i.test(input.schemaEvidenceSha256)) fail('SCHEMA_028_ACTIVATION_EVIDENCE_INVALID')
    if (!input.migrationAuthorizationId || !input.backupId || !input.requestedBy.userId || !input.requestedBy.displayName || Date.parse(input.expiresAt) <= this.now().getTime()) fail('SCHEMA_028_ACTIVATION_AUTHORIZATION_INVALID')
    const authorized = await this.coordinator.createCanonicalMaintenanceAuthorization({
      previousLiveSha: input.previousLiveSha.toLowerCase(), targetSha: input.targetSha.toLowerCase(), targetBranch: 'main',
      authorizationMode: 'schema_028_migration_activation', approvalManifestSha256: input.migrationAuthorizationSha256,
      canonicalIdentitySha256: input.canonicalIdentitySha256, canonicalStoreId: input.canonicalStoreId,
      schema: '027', databaseStatus: 'HEALTHY', migrationRequired: false, recoveryRequired: false,
      requestId: `schema-028:${input.migrationAuthorizationId}`, requestSha256: input.migrationAuthorizationSha256,
      requestedBy: input.requestedBy, historicalRuntimeEvidenceSha256: input.historicalRuntimeEvidenceSha256,
      schemaEvidenceSha256: input.schemaEvidenceSha256, backupId: input.backupId, expiresAt: input.expiresAt,
    })
    return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorized.authorizationId, ['AUTHORIZED'], 'BACKUP_VERIFIED', { backupId: input.backupId })
  }

  read(authorizationId: string) { return this.coordinator.readCanonicalMaintenanceAuthorization(authorizationId) }
  claimTarget(authorizationId: string) { return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['BACKUP_VERIFIED'], 'TARGET_CLAIMED') }
  targetHealthy(authorizationId: string) { return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['TARGET_CLAIMED'], 'TARGET_HEALTHY') }
  targetFailed(authorizationId: string, failure: string) { return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['TARGET_CLAIMED'], 'TARGET_FAILED', { failure: failure.slice(0, 500) }) }
  backupFailed(authorizationId: string, failure: string) { return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['AUTHORIZED'], 'BACKUP_FAILED', { failure: failure.slice(0, 500) }) }
  claimRecovery(authorizationId: string) { return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['RECOVERY_AUTHORIZED', 'BACKUP_FAILED', 'TARGET_FAILED'], 'RECOVERY_CLAIMED') }
  recoveryHealthy(authorizationId: string) { return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['RECOVERY_CLAIMED'], 'RECOVERY_HEALTHY') }
  recoveryFailed(authorizationId: string, failure: string) { return this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['RECOVERY_CLAIMED'], 'RECOVERY_FAILED', { failure: failure.slice(0, 500) }) }
}

type ApprovalManifest = { activeSourceSha: string; previousLiveSha: string; branch: string; mode?: string; reviewedCheckpointSha?: string; controlCommitSha: string }
type StoreIdentity = { role: string; databaseDirectory: string; storeId: string }

const paths = (projectRoot: string) => ({
  approval: join(projectRoot, '.runtime', 'andalucia-local-ui-approval.json'),
  identity: join(projectRoot, '.data', 'andalucia-store-identity.json'),
  requests: join(projectRoot, '.backups', '.db2', 'requests'),
  audit: join(projectRoot, '.backups', '.db2', 'audit.jsonl'),
  operations: join(projectRoot, '.backups', '.db2', 'operations'),
  startupLog: join(projectRoot, '.runtime', 'logs', 'guarded-startup.jsonl'),
  ownerMarker: join(projectRoot, '.runtime', 'canonical-owner.json'),
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

const completedSchema028Bindings = async (projectRoot: string, expectedSha: string, verifyStoppedStore: boolean, exclusiveCheck = portsClosed) => {
  const head = git(projectRoot, 'rev-parse', 'HEAD').toLowerCase(); const origin = git(projectRoot, 'rev-parse', 'refs/remotes/origin/main').toLowerCase(); const branch = git(projectRoot, 'branch', '--show-current')
  if (branch !== 'main' || head !== expectedSha || origin !== head) fail('SCHEMA_028_ACTIVATION_SOURCE_MISMATCH')
  const { resolveRuntimeSchemaActivation } = await import('./runtime-schema-activation-control.js')
  const resolution = await resolveRuntimeSchemaActivation(projectRoot, expectedSha)
  if (resolution.mode !== 'approved-027-to-028' || resolution.requiredSchemaVersion !== '028') fail('SCHEMA_028_ACTIVATION_MIGRATION_INCOMPLETE')
  const artifactPath = join(projectRoot, '.backups', resolution.backupId, 'live-migration-authorization.json')
  const artifact = await json<any>(artifactPath); const artifactSha = await fileSha256(artifactPath)
  const identityPath = paths(projectRoot).identity; const identity = await json<StoreIdentity>(identityPath); const identitySha = await fileSha256(identityPath)
  const now = Date.now(); const createdAt = Date.parse(artifact.createdAt); const consumedAt = Date.parse(artifact.consumedAt); const expiresAt = Date.parse(artifact.expiresAt)
  if (artifact.id !== resolution.authorizationId || artifact.state !== 'consumed' || !Number.isFinite(createdAt) || !Number.isFinite(consumedAt) || !Number.isFinite(expiresAt) || consumedAt < createdAt || consumedAt > expiresAt || now >= expiresAt) fail('SCHEMA_028_ACTIVATION_AUTHORIZATION_EXPIRED_OR_INVALID')
  const owner = artifact.ownerSession
  if (!owner?.isOwner || !owner.globalScope || !owner.userId || !owner.displayName || !Array.isArray(owner.requiredPermissions) || !['manage_platform','manage_duty_roster'].every(permission => owner.requiredPermissions.includes(permission)) || Date.parse(owner.sessionExpiresAt) < expiresAt) fail('SCHEMA_028_ACTIVATION_MANAGER_AUTHORIZATION_INVALID')
  if (identity.role !== 'canonical' || identity.storeId !== artifact.canonicalStoreId || resolve(identity.databaseDirectory) !== resolve(projectRoot, '.data', 'postgres')) fail('SCHEMA_028_ACTIVATION_CANONICAL_IDENTITY_INVALID')
  if (verifyStoppedStore) {
    if (!await exclusiveCheck() || existsSync(paths(projectRoot).ownerMarker)) fail('SCHEMA_028_ACTIVATION_STOPPED_RUNTIME_NOT_EXCLUSIVE')
    if (existsSync(resolve(projectRoot, '.data', 'migration-in-progress')) || existsSync(resolve(projectRoot, '.data', 'recovery-in-progress'))) fail('SCHEMA_028_ACTIVATION_OPERATION_CONFLICT')
    const [{ PGlite }, { createMigrationFingerprint, migrationStatus }] = await Promise.all([import('@electric-sql/pglite'), import('./migration-store.js')])
    const databaseDirectory = resolve(projectRoot, '.data', 'postgres'); const db = new PGlite(databaseDirectory)
    try {
      const status = await migrationStatus(db); const applied = status.migrations.filter(item => item.state === 'applied'); const target = status.migrations.find(item => item.version === '028'); const fingerprint = await createMigrationFingerprint(db)
      if (applied.at(-1)?.version !== '028' || target?.checksumMatches !== true || target?.checksum !== artifact.targetMigration?.checksum || fingerprint.digest !== artifact.consumedPostMigrationFingerprint) fail('SCHEMA_028_ACTIVATION_LIVE_MIGRATION_STATE_CHANGED')
    } finally { await db.close() }
  }
  return { resolution, artifact, artifactPath, artifactSha, identity, identitySha }
}

const assertBindings = async (projectRoot: string, record: CanonicalMaintenanceAuthorization, verifyStoppedStore = false, exclusiveCheck = portsClosed) => {
  if (record.authorizationMode === 'schema_028_migration_activation') {
    const bindings = await completedSchema028Bindings(projectRoot, record.targetSha, verifyStoppedStore, exclusiveCheck)
    const runtimeDigest = await historicalRuntimeEvidence(projectRoot, record.previousLiveSha, 'main', 'verified_main')
    const schemaEvidenceSha256 = sha256(JSON.stringify({ targetSha: record.targetSha, migrationAuthorizationId: bindings.artifact.id, backupId: bindings.resolution.backupId, postMigrationFingerprint: bindings.artifact.consumedPostMigrationFingerprint }))
    try { execFileSync('git', ['-C', projectRoot, 'merge-base', '--is-ancestor', record.previousLiveSha, record.targetSha], { stdio: 'ignore' }) } catch { fail('SCHEMA_028_ACTIVATION_RUNTIME_ANCESTRY_INVALID') }
    if (record.previousLiveSha === record.targetSha || record.targetBranch !== 'main' || record.expiresAt !== bindings.artifact.expiresAt || record.canonicalIdentitySha256 !== bindings.identitySha || record.canonicalStoreId !== bindings.identity.storeId || record.requestId !== `schema-028:${bindings.artifact.id}` || record.requestSha256 !== bindings.artifactSha || record.approvalManifestSha256 !== bindings.artifactSha || record.backupId !== bindings.resolution.backupId || record.historicalRuntimeEvidenceSha256 !== runtimeDigest || record.schemaEvidenceSha256 !== schemaEvidenceSha256 || record.requestedBy.userId !== bindings.artifact.ownerSession.userId || record.requestedBy.displayName !== bindings.artifact.ownerSession.displayName) fail('SCHEMA_028_ACTIVATION_PROTECTED_BINDING_MISMATCH')
    return bindings
  }
  const bindings = await currentBindings(projectRoot)
  if (bindings.approvalSha !== record.approvalManifestSha256 || bindings.identitySha !== record.canonicalIdentitySha256 || bindings.identity.storeId !== record.canonicalStoreId || bindings.approval.activeSourceSha !== record.targetSha || bindings.approval.previousLiveSha !== record.previousLiveSha) fail('REQUESTED_BACKUP_PROTECTED_BINDING_MISMATCH')
  return bindings
}

const latestVerifiedSchemaEvidence = async (projectRoot: string): Promise<string> => {
  const backupRoot = join(projectRoot, '.backups')
  const names = existsSync(backupRoot) ? await readdir(backupRoot) : []
  for (const name of names.sort().reverse()) {
    const folder = join(backupRoot, name)
    try {
      const metadataPath = join(folder, 'backup-metadata.json'); const restorePath = join(folder, 'restore-test.json')
      const metadata = await json<any>(metadataPath); const restore = await json<any>(restorePath)
      if (metadata.schemaVersion === '027' && metadata.verificationStatus === 'VERIFIED' && metadata.openTestStatus === 'PASS' && metadata.preflightStatus === 'READY' && restore.status === 'RESTORE_TEST_PASSED' && restore.manifestMatch && restore.fingerprintMatch && restore.migrationMatch && restore.preflightStatus === 'READY') {
        return sha256(`${await fileSha256(metadataPath)}:${await fileSha256(restorePath)}`)
      }
    } catch { /* not a verified backup folder */ }
  }
  return fail('REQUESTED_BACKUP_VERIFIED_SCHEMA_EVIDENCE_MISSING')
}

const structuredDetail = (value: unknown): Record<string, string> => {
  if (typeof value !== 'string' || !value) fail('REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_INVALID')
  const detail = value as string
  const fields: Record<string, string> = {}
  for (const part of detail.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0 || separator === part.length - 1) fail('REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_INVALID')
    const key = part.slice(0, separator); const fieldValue = part.slice(separator + 1)
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key) || Object.hasOwn(fields, key)) fail('REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_INVALID')
    fields[key] = fieldValue
  }
  return fields
}

const canonicalTimestamp = (value: unknown): string => {
  if (typeof value !== 'string') fail('REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_INVALID')
  const timestamp = value as string
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{1,7})Z$/.exec(timestamp) ?? fail('REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_INVALID')
  const [, year, month, day, hour, minute, second, fraction] = match
  const parts = [year, month, day, hour, minute, second].map(Number)
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]))
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() + 1 !== parts[1] || date.getUTCDate() !== parts[2] || date.getUTCHours() !== parts[3] || date.getUTCMinutes() !== parts[4] || date.getUTCSeconds() !== parts[5]) fail('REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_INVALID')
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.padEnd(7, '0')}Z`
}

const historicalRuntimeEvidence = async (projectRoot: string, previousLiveSha: string, expectedBranch: string, expectedMode: string): Promise<string> => {
  const logPath = paths(projectRoot).startupLog
  if (!existsSync(logPath)) fail('REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_MISSING')
  if (!expectedBranch || !expectedMode) fail('REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_INVALID')
  const lines = (await readFile(logPath, 'utf8')).split(/\r?\n/).filter(Boolean)
  const entries = lines.map((raw, index) => {
    let item: any
    const parseable = index === 0 && raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
    try { item = JSON.parse(parseable) } catch { return fail('REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_INVALID') }
    if (item?.version !== 'andalucia-guarded-startup-v1' || typeof item.state !== 'string') fail('REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_INVALID')
    return { raw, index, item, recordedAt: canonicalTimestamp(item.recordedAt) }
  })
  const approved = entries.filter(({ item }) => {
    if (item.state !== 'SOURCE_APPROVED') return false
    const detail = structuredDetail(item.detail)
    if (!/^[0-9a-f]{40}$/i.test(detail.sha || '') || !detail.branch || !detail.mode || Object.keys(detail).length !== 3) fail('REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_INVALID')
    return detail.sha.toLowerCase() === previousLiveSha && detail.branch === expectedBranch && detail.mode === expectedMode
  }).at(-1) ?? fail('REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_INVALID')
  const nextApprovalIndex = entries.find(({ index, item }) => index > approved.index && item.state === 'SOURCE_APPROVED')?.index ?? entries.length
  const terminal = entries.find(({ index, item }) => index > approved.index && index < nextApprovalIndex && (item.state === 'EXITED' || item.state === 'FAILED')) ?? fail('REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_INVALID')
  if (terminal.item.state !== 'EXITED' || terminal.recordedAt < approved.recordedAt) fail('REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_INVALID')
  const exitDetail = structuredDetail(terminal.item.detail)
  if (Object.keys(exitDetail).length !== 1 || !/^-?\d+$/.test(exitDetail.exitCode || '') || Number(exitDetail.exitCode) !== 0) fail('REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_INVALID')
  git(projectRoot, 'cat-file', '-e', `${previousLiveSha}^{commit}`)
  return sha256(`${approved.raw}\n${terminal.raw}`)
}

const latestStoppedMainRuntimeEvidence = async (projectRoot: string, targetSha: string) => {
  const logPath = paths(projectRoot).startupLog
  if (!existsSync(logPath)) fail('SCHEMA_028_ACTIVATION_HISTORICAL_RUNTIME_EVIDENCE_MISSING')
  const lines = (await readFile(logPath, 'utf8')).split(/\r?\n/).filter(Boolean)
  for (const raw of lines.reverse()) {
    let item: any
    try { item = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw) } catch { continue }
    if (item?.state !== 'SOURCE_APPROVED') continue
    let detail: Record<string, string>
    try { detail = structuredDetail(item.detail) } catch { continue }
    const previousLiveSha = String(detail.sha || '').toLowerCase()
    if (!/^[0-9a-f]{40}$/.test(previousLiveSha) || previousLiveSha === targetSha || detail.branch !== 'main' || detail.mode !== 'verified_main') continue
    try { execFileSync('git', ['-C', projectRoot, 'merge-base', '--is-ancestor', previousLiveSha, targetSha], { stdio: 'ignore' }) } catch { continue }
    try { return { previousLiveSha, digest: await historicalRuntimeEvidence(projectRoot, previousLiveSha, 'main', 'verified_main') } } catch { /* continue to an older complete runtime */ }
  }
  return fail('SCHEMA_028_ACTIVATION_HISTORICAL_RUNTIME_EVIDENCE_INVALID')
}

const portsClosed = async () => {
  for (const port of [3001, 5173, 5174]) {
    const open = await new Promise<boolean>(resolveOpen => {
      const socket = createConnection({ host: '127.0.0.1', port })
      const done = (value: boolean) => { socket.destroy(); resolveOpen(value) }
      socket.setTimeout(750, () => done(false)); socket.once('connect', () => done(true)); socket.once('error', () => done(false))
    })
    if (open) return false
  }
  return true
}

export const prepareCompletedSchema028Activation = async (projectRootInput: string, expectedShaInput: string, dependencies: { portsClosed?: () => Promise<boolean> } = {}) => {
  const projectRoot = resolve(projectRootInput); const expectedSha = expectedShaInput.toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(expectedSha) || !await (dependencies.portsClosed || portsClosed)() || existsSync(paths(projectRoot).ownerMarker)) fail('SCHEMA_028_ACTIVATION_STOPPED_RUNTIME_NOT_EXCLUSIVE')
  const bindings = await completedSchema028Bindings(projectRoot, expectedSha, true, dependencies.portsClosed || portsClosed)
  const runtime = await latestStoppedMainRuntimeEvidence(projectRoot, expectedSha)
  const schemaEvidenceSha256 = sha256(JSON.stringify({ targetSha: expectedSha, migrationAuthorizationId: bindings.artifact.id, backupId: bindings.resolution.backupId, postMigrationFingerprint: bindings.artifact.consumedPostMigrationFingerprint }))
  const coordinator = new DatabaseOperationCoordinator(paths(projectRoot).operations)
  return new RequestedBackupActivationControl(coordinator).prepareCompletedSchema028Migration({
    previousLiveSha: runtime.previousLiveSha, targetSha: expectedSha, canonicalIdentitySha256: bindings.identitySha,
    canonicalStoreId: bindings.identity.storeId, migrationAuthorizationId: bindings.artifact.id,
    migrationAuthorizationSha256: bindings.artifactSha, backupId: bindings.resolution.backupId,
    requestedBy: { userId: bindings.artifact.ownerSession.userId, displayName: bindings.artifact.ownerSession.displayName },
    historicalRuntimeEvidenceSha256: runtime.digest, schemaEvidenceSha256, expiresAt: bindings.artifact.expiresAt,
  })
}

export async function runRequestedBackupActivationControl(command: string, argv = process.argv, dependencies: { portsClosed?: () => Promise<boolean> } = {}) {
  const arg = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined }
  const required = (name: string) => arg(name) || fail(`ARGUMENT_REQUIRED:${name}`)
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
  if (command === 'prepare-stopped-recovery') {
    const bindings = await currentBindings(projectRoot)
    const previousLiveSha = bindings.approval.previousLiveSha.toLowerCase()
    if (!await (dependencies.portsClosed || portsClosed)() || existsSync(paths(projectRoot).ownerMarker)) fail('REQUESTED_BACKUP_STOPPED_RUNTIME_NOT_EXCLUSIVE')
    const request = await requestById(projectRoot, arg('--request-id'))
    const runtimeEvidence = await historicalRuntimeEvidence(projectRoot, previousLiveSha, bindings.approval.branch, String(bindings.approval.mode || ''))
    const schemaEvidence = await latestVerifiedSchemaEvidence(projectRoot)
    return control.prepareStoppedRecovery({ previousLiveSha, targetSha: bindings.approval.activeSourceSha.toLowerCase(), targetBranch: bindings.approval.branch, approvalManifestSha256: bindings.approvalSha, canonicalIdentitySha256: bindings.identitySha, canonicalStoreId: bindings.identity.storeId, request, requestAuditVerified: await requestAuditVerified(projectRoot, request), historicalRuntimeEvidenceSha256: runtimeEvidence, schemaEvidenceSha256: schemaEvidence })
  }
  if (command === 'prepare-schema-028-activation') return prepareCompletedSchema028Activation(projectRoot, required('--expected-sha'))
  const authorizationId = required('--authorization-id')
  const record = await control.read(authorizationId)
  await assertBindings(projectRoot, record, command === 'inspect-target' || command === 'claim-target', dependencies.portsClosed || portsClosed)
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
