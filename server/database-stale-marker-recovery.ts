import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { authenticateOfflineManager } from './offline-recovery-request-control.js'
import { copyStoreVerified, createStoreManifest, manifestsMatch } from './migration-filesystem.js'
import { createStoreIdentity, openVerifiedDatabase, readStoreIdentity } from './database-protection.js'
import { DatabaseOperationCoordinator, type CanonicalMaintenanceAuthorization } from './database-operation-coordinator.js'

const SHA = /^[0-9a-f]{40}$/i
const HASH = /^[0-9a-f]{64}$/i
const fail = (code: string): never => { throw new Error(code) }
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  return JSON.stringify(value)
}

export type Db3BackupEvidence = {
  backupId: string; backupDirectory: string; createdAt: string; schemaVersion: string
  verificationStatus: string; openTestStatus: string; preflightStatus: string
  restoreStatus: string; manifestMatch: boolean; fingerprintMatch: boolean; migrationMatch: boolean
  restorePreflightStatus: string; metadataSha256: string; restoreSha256: string; backupManifest: any
}
export type Db3MarkerEvidence = {
  sourceSha: string; sourceBranch: string; originMainSha: string; sourceClean: boolean
  canonicalDirectory: string; canonicalStoreId: string; canonicalIdentitySha256: string
  markerPath: string; markerSha256: string; markerLength: number; markerLastWriteUtc: string; markerSentinel: string
  ownershipState: 'STALE' | 'AMBIGUOUS'; exclusiveRead: boolean; listenerCount: number; matchingProcessCount: number; runningTaskCount: number
  activeOperationCount: number; ownerMarkerPresent: boolean; migrationMarkerPresent: boolean; recoveryMarkerPresent: boolean
  backup: Db3BackupEvidence
}
type Actor = { userId: string; displayName: string }
type RecoveryResult = { schema: string; databaseHealthy: boolean; markerReleased: boolean }

const evidenceBinding = (evidence: Db3MarkerEvidence) => sha256(stable({
  sourceSha: evidence.sourceSha, sourceBranch: evidence.sourceBranch, originMainSha: evidence.originMainSha,
  canonicalDirectory: resolve(evidence.canonicalDirectory), canonicalStoreId: evidence.canonicalStoreId,
  canonicalIdentitySha256: evidence.canonicalIdentitySha256, markerSha256: evidence.markerSha256,
  markerLength: evidence.markerLength, markerLastWriteUtc: evidence.markerLastWriteUtc, markerSentinel: evidence.markerSentinel,
  backupId: evidence.backup.backupId, backupDirectory: resolve(evidence.backup.backupDirectory), backupMetadataSha256: evidence.backup.metadataSha256,
  backupRestoreSha256: evidence.backup.restoreSha256, schemaVersion: evidence.backup.schemaVersion,
}))

export const assertDb3StaleMarkerEvidence = (evidence: Db3MarkerEvidence) => {
  if (!SHA.test(evidence.sourceSha) || evidence.sourceBranch !== 'main' || evidence.originMainSha !== evidence.sourceSha || !evidence.sourceClean) fail('DB3_SOURCE_IDENTITY_INVALID')
  if (evidence.canonicalStoreId !== 'andalucia-canonical-live' || !HASH.test(evidence.canonicalIdentitySha256)) fail('DB3_CANONICAL_IDENTITY_INVALID')
  if (evidence.markerSentinel !== '-42' || !HASH.test(evidence.markerSha256) || evidence.markerLength <= 0) fail('DB3_STALE_MARKER_INVALID')
  if (evidence.ownershipState !== 'STALE' || !evidence.exclusiveRead || evidence.listenerCount || evidence.matchingProcessCount || evidence.runningTaskCount) fail('DB3_MARKER_OWNERSHIP_NOT_EXCLUSIVE')
  if (evidence.activeOperationCount || evidence.ownerMarkerPresent || evidence.migrationMarkerPresent || evidence.recoveryMarkerPresent) fail('DB3_CANONICAL_OPERATION_NOT_EXCLUSIVE')
  const backup = evidence.backup
  if (!backup.backupId || backup.schemaVersion !== '027' || backup.verificationStatus !== 'VERIFIED' || backup.openTestStatus !== 'PASS' || backup.preflightStatus !== 'READY' || backup.restoreStatus !== 'RESTORE_TEST_PASSED' || !backup.manifestMatch || !backup.fingerprintMatch || !backup.migrationMatch || backup.restorePreflightStatus !== 'READY' || !HASH.test(backup.metadataSha256) || !HASH.test(backup.restoreSha256)) fail('DB3_VERIFIED_RESTORE_READY_BACKUP_REQUIRED')
}

export class Db3StaleMarkerRecoveryControl {
  constructor(readonly coordinator: DatabaseOperationCoordinator, readonly now = () => new Date()) {}

  async prepare(evidence: Db3MarkerEvidence, actor: Actor) {
    assertDb3StaleMarkerEvidence(evidence)
    if (!actor.userId || !actor.displayName) fail('DB3_AUTHENTICATED_MANAGER_REQUIRED')
    const binding = evidenceBinding(evidence)
    return this.coordinator.createCanonicalMaintenanceAuthorization({
      authorizationMode: 'stale_marker_recovery', previousLiveSha: evidence.sourceSha, targetSha: evidence.sourceSha, targetBranch: 'main',
      approvalManifestSha256: sha256(stable({ sourceSha: evidence.sourceSha, branch: evidence.sourceBranch, originMainSha: evidence.originMainSha })),
      canonicalIdentitySha256: evidence.canonicalIdentitySha256, canonicalStoreId: evidence.canonicalStoreId,
      schema: '027', databaseStatus: 'HEALTHY', migrationRequired: false, recoveryRequired: false,
      requestId: `db3-stale-marker:${evidence.sourceSha}:${evidence.markerSha256}`,
      requestSha256: binding, requestedBy: actor, backupId: evidence.backup.backupId,
      historicalRuntimeEvidenceSha256: evidence.markerSha256, schemaEvidenceSha256: sha256(stable({ backupId: evidence.backup.backupId, schema: '027', metadata: evidence.backup.metadataSha256, restore: evidence.backup.restoreSha256 })),
      expiresAt: new Date(this.now().getTime() + 10 * 60_000).toISOString(),
    }, 'RECOVERY_AUTHORIZED')
  }

  async recover(authorizationId: string, dependencies: {
    inspect: (operationId: string) => Promise<Db3MarkerEvidence>
    preserve: (authorization: CanonicalMaintenanceAuthorization, evidence: Db3MarkerEvidence) => Promise<void>
    recoverStore: (evidence: Db3MarkerEvidence) => Promise<RecoveryResult>
  }) {
    const authorization = await this.coordinator.readCanonicalMaintenanceAuthorization(authorizationId)
    if (authorization.authorizationMode !== 'stale_marker_recovery' || authorization.state !== 'RECOVERY_AUTHORIZED' || Date.parse(authorization.expiresAt) <= this.now().getTime()) fail('DB3_RECOVERY_AUTHORIZATION_INVALID')
    const operation = await this.coordinator.acquire({ operationType: 'stale_marker_recovery', resource: { kind: 'canonical', id: authorization.canonicalStoreId }, backupId: authorization.backupId })
    let claimed = false
    try {
      const evidence = await dependencies.inspect(operation.operationId)
      assertDb3StaleMarkerEvidence(evidence)
      if (evidenceBinding(evidence) !== authorization.requestSha256 || evidence.canonicalIdentitySha256 !== authorization.canonicalIdentitySha256 || evidence.canonicalStoreId !== authorization.canonicalStoreId || evidence.sourceSha !== authorization.targetSha || evidence.backup.backupId !== authorization.backupId) fail('DB3_RECOVERY_EVIDENCE_CHANGED')
      await this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['RECOVERY_AUTHORIZED'], 'RECOVERY_CLAIMED')
      claimed = true
      await dependencies.preserve(authorization, evidence)
      const result = await dependencies.recoverStore(evidence)
      if (!result.databaseHealthy || result.schema !== '027' || !result.markerReleased) fail('DB3_RECOVERY_POST_OPEN_HEALTH_INVALID')
      await this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['RECOVERY_CLAIMED'], 'RECOVERY_HEALTHY')
      await operation.succeed({ authorizationId, backupId: authorization.backupId, markerSha256: evidence.markerSha256, schema: result.schema })
      return { authorizationId, state: 'RECOVERY_HEALTHY', sourceSha: evidence.sourceSha, backupId: authorization.backupId, schema: result.schema }
    } catch (error) {
      if (claimed) await this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['RECOVERY_CLAIMED'], 'RECOVERY_FAILED', { failure: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }).catch(() => undefined)
      else await this.coordinator.transitionCanonicalMaintenanceAuthorization(authorizationId, ['RECOVERY_AUTHORIZED'], 'RECOVERY_FAILED', { failure: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }).catch(() => undefined)
      await operation.fail(error, { authorizationId, backupId: authorization.backupId }).catch(() => undefined)
      throw error
    }
  }
}

const latestRestoreReadyBackup = async (backupRoot: string, canonicalDirectory: string): Promise<Db3BackupEvidence> => {
  const candidates: Db3BackupEvidence[] = []
  for (const entry of await readdir(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const folder = join(backupRoot, entry.name); const metadataPath = join(folder, 'backup-metadata.json'); const restorePath = join(folder, 'restore-test.json')
    if (!existsSync(metadataPath) || !existsSync(restorePath)) continue
    try {
      const metadataBuffer = await readFile(metadataPath); const restoreBuffer = await readFile(restorePath)
      const metadata = JSON.parse(metadataBuffer.toString('utf8')); const restore = JSON.parse(restoreBuffer.toString('utf8'))
      if (metadata.backupId !== entry.name || resolve(metadata.backupDirectory || '') !== resolve(folder, 'postgres') || resolve(metadata.sourceDirectory || '') !== canonicalDirectory || metadata.storeIdentity?.storeId !== 'andalucia-canonical-live' || restore.backupId !== metadata.backupId) continue
      candidates.push({ backupId: metadata.backupId, backupDirectory: metadata.backupDirectory, createdAt: metadata.createdAt, schemaVersion: metadata.schemaVersion, verificationStatus: metadata.verificationStatus, openTestStatus: metadata.openTestStatus, preflightStatus: metadata.preflightStatus, restoreStatus: restore.status, manifestMatch: Boolean(restore.manifestMatch), fingerprintMatch: Boolean(restore.fingerprintMatch), migrationMatch: Boolean(restore.migrationMatch), restorePreflightStatus: restore.preflightStatus, metadataSha256: sha256(metadataBuffer), restoreSha256: sha256(restoreBuffer), backupManifest: metadata.backupManifest })
    } catch { /* Invalid evidence is never eligible. */ }
  }
  const eligible = candidates.filter(item => item.schemaVersion === '027' && item.verificationStatus === 'VERIFIED' && item.openTestStatus === 'PASS' && item.preflightStatus === 'READY' && item.restoreStatus === 'RESTORE_TEST_PASSED' && item.manifestMatch && item.fingerprintMatch && item.migrationMatch && item.restorePreflightStatus === 'READY').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return eligible[0] || fail('DB3_VERIFIED_RESTORE_READY_BACKUP_REQUIRED')
}

const inspectEvidence = async (projectRoot: string, coordinator: DatabaseOperationCoordinator, expectedBackupId?: string, allowedOperationId?: string): Promise<Db3MarkerEvidence> => {
  const canonicalDirectory = resolve(projectRoot, '.data', 'postgres'); const markerPath = join(canonicalDirectory, 'postmaster.pid')
  const identityPath = resolve(projectRoot, '.data', 'andalucia-store-identity.json'); const identityBuffer = await readFile(identityPath); const identity = JSON.parse(identityBuffer.toString('utf8'))
  if (identity.role !== 'canonical' || resolve(identity.databaseDirectory) !== canonicalDirectory) fail('DB3_CANONICAL_IDENTITY_INVALID')
  const ownershipScript = resolve(projectRoot, 'deployment', 'windows', 'Test-AndaluciaDb3StaleMarkerOwnership.ps1')
  const ownership = JSON.parse(execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', ownershipScript, '-MarkerPath', markerPath, '-CanonicalRoot', canonicalDirectory, '-InspectorProcessId', String(process.pid)], { encoding: 'utf8' }))
  const git = (args: string[]) => execFileSync('git', ['-C', projectRoot, ...args], { encoding: 'utf8' }).trim().toLowerCase()
  const sourceSha = git(['rev-parse', 'HEAD']); const sourceBranch = git(['branch', '--show-current']); const originMainSha = git(['rev-parse', 'refs/remotes/origin/main']); const sourceClean = !git(['status', '--porcelain', '--untracked-files=no'])
  const backup = await latestRestoreReadyBackup(resolve(projectRoot, '.backups'), canonicalDirectory)
  if (expectedBackupId && backup.backupId !== expectedBackupId) fail('DB3_RECOVERY_BACKUP_CHANGED')
  const activeOperations = (await coordinator.activeLeases()).filter(item => item.operationId !== allowedOperationId)
  return {
    sourceSha, sourceBranch, originMainSha, sourceClean, canonicalDirectory, canonicalStoreId: identity.storeId, canonicalIdentitySha256: sha256(identityBuffer),
    markerPath, markerSha256: ownership.markerSha256, markerLength: Number(ownership.markerLength), markerLastWriteUtc: ownership.markerLastWriteUtc, markerSentinel: ownership.sentinel,
    ownershipState: ownership.ownershipState, exclusiveRead: Boolean(ownership.exclusiveRead), listenerCount: ownership.listeners.length, matchingProcessCount: ownership.matchingProcesses.length, runningTaskCount: ownership.runningTasks.length,
    activeOperationCount: activeOperations.length, ownerMarkerPresent: existsSync(resolve(projectRoot, '.runtime', 'canonical-owner.json')), migrationMarkerPresent: existsSync(resolve(projectRoot, '.data', 'migration-in-progress')), recoveryMarkerPresent: existsSync(resolve(projectRoot, '.data', 'recovery-in-progress')),
    backup,
  }
}

const authenticateFromBackup = async (projectRoot: string, backup: Db3BackupEvidence, identifier: string, password: string) => {
  const temporaryRoot = resolve(projectRoot, '.backups', '.db2', 'temporary', `db3-auth-${randomUUID()}`); const disposable = join(temporaryRoot, 'postgres')
  try {
    const copied = await copyStoreVerified(backup.backupDirectory, disposable)
    if (!manifestsMatch(copied.sourceManifest, backup.backupManifest)) fail('DB3_BACKUP_MANIFEST_CHANGED')
    await createStoreIdentity(disposable, 'rehearsal', { storeId: `andalucia-db3-auth-${randomUUID()}` })
    const opened = await openVerifiedDatabase({ dataDirectory: disposable, role: 'rehearsal', requiredVersion: '027', backupRoot: resolve(projectRoot, '.backups') })
    try { return await authenticateOfflineManager(opened.db, identifier, password) } finally { await opened.db.close() }
  } finally { await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => undefined) }
}

const preserveIncidentEvidence = async (projectRoot: string, authorization: CanonicalMaintenanceAuthorization, evidence: Db3MarkerEvidence) => {
  const root = resolve(projectRoot, '.backups', '.db2', 'incidents', 'db3-stale-marker'); await mkdir(root, { recursive: true })
  const incident = join(root, authorization.authorizationId); await mkdir(incident)
  const marker = await readFile(evidence.markerPath); const markerStat = await stat(evidence.markerPath)
  if (sha256(marker) !== evidence.markerSha256 || markerStat.size !== evidence.markerLength || Math.abs(markerStat.mtimeMs - Date.parse(evidence.markerLastWriteUtc)) > 1) fail('DB3_RECOVERY_EVIDENCE_CHANGED')
  await writeFile(join(incident, 'postmaster.pid.evidence'), marker, { flag: 'wx' })
  await writeFile(join(incident, 'incident.json'), `${JSON.stringify({ version: 'andalucia-db3-stale-marker-incident-v1', authorizationId: authorization.authorizationId, preservedAt: new Date().toISOString(), sourceSha: evidence.sourceSha, canonicalStoreId: evidence.canonicalStoreId, markerSha256: evidence.markerSha256, markerLength: evidence.markerLength, markerLastWriteUtc: evidence.markerLastWriteUtc, backupId: evidence.backup.backupId, evidenceBinding: evidenceBinding(evidence) }, null, 2)}\n`, { flag: 'wx' })
}

const recoverPgliteStore = async (evidence: Db3MarkerEvidence): Promise<RecoveryResult> => {
  const marker = await readFile(evidence.markerPath); const markerStat = await stat(evidence.markerPath)
  if (sha256(marker) !== evidence.markerSha256 || markerStat.size !== evidence.markerLength || Math.abs(markerStat.mtimeMs - Date.parse(evidence.markerLastWriteUtc)) > 1) fail('DB3_RECOVERY_EVIDENCE_CHANGED')
  let db: PGlite | null = null
  try {
    db = new PGlite(evidence.canonicalDirectory); await db.query('select 1')
    const version = (await db.query<{ version: string }>("select version from schema_migrations where status='applied' order by version desc limit 1")).rows[0]?.version || ''
    if (version !== '027') fail('DB3_RECOVERY_SCHEMA_INVALID')
    const foundation = (await db.query<{ owners: number; outlets: number }>("select (select count(*)::int from user_accounts u join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true where u.status='active' and r.role_key='owner' and r.global_scope=true) owners,(select count(*)::int from outlet_scopes where scope_key='andalucia' and active=true) outlets")).rows[0]
    if (!foundation?.owners || !foundation?.outlets) fail('DB3_RECOVERY_FOUNDATION_INVALID')
    await db.close(); db = null
    return { schema: version, databaseHealthy: true, markerReleased: !existsSync(evidence.markerPath) }
  } finally { await db?.close().catch(() => undefined) }
}

async function readCredentials() {
  let value = ''; for await (const chunk of process.stdin) value += String(chunk)
  const parsed = JSON.parse(value) as { identifier?: string; password?: string }
  return { identifier: String(parsed.identifier || ''), password: String(parsed.password || '') }
}

export async function runDb3StaleMarkerRecovery(projectRootInput: string, credentials: { identifier: string; password: string }) {
  const projectRoot = resolve(projectRootInput); const operationsRoot = resolve(projectRoot, '.backups', '.db2', 'operations'); const coordinator = new DatabaseOperationCoordinator(operationsRoot); const control = new Db3StaleMarkerRecoveryControl(coordinator)
  const initial = await inspectEvidence(projectRoot, coordinator); assertDb3StaleMarkerEvidence(initial)
  const actor = await authenticateFromBackup(projectRoot, initial.backup, credentials.identifier, credentials.password)
  const authorization = await control.prepare(initial, actor)
  return control.recover(authorization.authorizationId, { inspect: operationId => inspectEvidence(projectRoot, coordinator, initial.backup.backupId, operationId), preserve: (record, evidence) => preserveIncidentEvidence(projectRoot, record, evidence), recoverStore: recoverPgliteStore })
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const index = process.argv.indexOf('--project-root'); const projectRoot = index >= 0 ? process.argv[index + 1] : ''
  if (!projectRoot) fail('ARGUMENT_REQUIRED:--project-root')
  readCredentials().then(credentials => runDb3StaleMarkerRecovery(projectRoot, credentials)).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 })
}
