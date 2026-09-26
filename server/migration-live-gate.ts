import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { open, readFile, unlink } from 'node:fs/promises'
import { connect } from 'node:net'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { copyStoreVerified, createStoreManifest, manifestsMatch, writeJsonAtomic, type StoreManifest } from './migration-filesystem.js'
import { createMigrationFingerprint, isLiveStorePath, liveStore, reviewedMigrationSet, runPreflight } from './migration-store.js'
import { createFinancialFinalizationFingerprint, createVerifiedBackup, requireRecentVerifiedBackup } from './database-backup.js'
import { operationMarkerPaths, readStoreIdentity } from './database-protection.js'
import { schedulerJobBlocksMigration } from './database-scheduler.js'

export const LIVE_MIGRATION_AUTHORIZATION_PHRASE = 'YES_I_APPROVE_LIVE_MIGRATION'
export const LIVE_EXCLUSIVE_ACCESS_PHRASE = 'YES_I_CONFIRM_ANDALUCIA_APP_IS_STOPPED'
const artifactVersion = 'andalucia-live-migration-authorization-v1'
const normalized = (value: string) => resolve(value).replaceAll('\\', '/').toLowerCase()
const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const endpointOpen = (host: string, port: number) => new Promise<boolean>(resolveResult => {
  const socket = connect({ host, port }); let settled = false
  const finish = (value: boolean) => { if (settled) return; settled = true; socket.destroy(); resolveResult(value) }
  socket.setTimeout(300); socket.once('connect', () => finish(true)); socket.once('timeout', () => finish(false)); socket.once('error', () => finish(false))
})
const portOpen = async (port: number) => (await Promise.all(['localhost', '127.0.0.1', '::1'].map(host => endpointOpen(host, port)))).some(Boolean)
export const defaultExclusiveAccessCheck = async () => {
  if (process.env.ANDALUCIA_CONFIRM_LIVE_STORE_EXCLUSIVE !== LIVE_EXCLUSIVE_ACCESS_PHRASE) return false
  const listening = await Promise.all([3001, 5173, 5174].map(portOpen))
  return listening.every(value => !value)
}

export type LiveMigrationAuthorizationArtifact = {
  artifactVersion: string
  id: string
  state: 'prepared' | 'consumed' | 'abandoned'
  createdAt: string
  consumedAt?: string
  abandonedAt?: string
  abandonReason?: string
  sourceDirectory: string
  backupDirectory: string
  sourceManifestAtBackup: StoreManifest
  backupManifest: StoreManifest
  preparedSourceManifest: StoreManifest
  sourceFingerprintDigest: string
  sourceBusinessSnapshot: Record<string, number>
  preflightStatus: 'READY'
  migrationSet: Awaited<ReturnType<typeof reviewedMigrationSet>>
  rollbackInstructions: string
  consumedPostMigrationFingerprint?: string
  verifiedBackupMetadataPath?: string
  expiresAt?: string
  targetMigration?: { version: string; name: string; checksum: string }
  canonicalStoreId?: string
  outletScopeId?: string
  sourceFinancialFingerprintDigest?: string
  sourceMigrationLedger?: Awaited<ReturnType<typeof import('./migration-store.js')['migrationStatus']>>
  ownerSession?: { sessionId: string; sessionExpiresAt: string; userId: string; loginIdentifier: string; displayName: string; isOwner: true; globalScope: true; requiredPermissions: string[] }
  protectedBackup?: { backupId: string; pinned: true; restoreRehearsal: 'PASS' }
  rehearsal?: { status: 'PASS'; migratedSchema: string; rollbackSchema: string; completedAt: string }
  evidenceFingerprints?: Record<string, { count: number; digest: string }>
}
const readArtifact = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as LiveMigrationAuthorizationArtifact

export const prepareLiveMigration = async (options: {
  sourceDirectory: string
  expectedLiveStore?: string
  backupRoot?: string
  exclusiveCheck?: () => Promise<boolean>
  now?: Date
}) => {
  if (!options.sourceDirectory || !isAbsolute(options.sourceDirectory)) throw new Error('MIGRATION_DATA_DIR_REQUIRED')
  const sourceDirectory = resolve(options.sourceDirectory); const expectedLiveStore = resolve(options.expectedLiveStore || liveStore)
  if (existsSync(operationMarkerPaths(sourceDirectory).recovery)) throw new Error('RECOVERY_IN_PROGRESS_OPERATION_BLOCKED')
  if (!isLiveStorePath(sourceDirectory, expectedLiveStore)) throw new Error('LIVE_MIGRATION_TARGET_PATH_MISMATCH')
  if (!(await (options.exclusiveCheck || defaultExclusiveAccessCheck)())) throw new Error('LIVE_STORE_NOT_EXCLUSIVE')
  const migrationSet = await reviewedMigrationSet()
  const stamp = (options.now || new Date()).toISOString().replaceAll(':', '').replaceAll('.', '-')
  const backupRoot = resolve(options.backupRoot || join(dirname(expectedLiveStore), '..', '.backups'))
  let folder: string; let backupDirectory: string; let sourceManifestAtBackup: StoreManifest; let backupManifest: StoreManifest; let verifiedBackupMetadataPath: string | undefined
  if (isLiveStorePath(sourceDirectory, liveStore)) {
    await readStoreIdentity(sourceDirectory, 'canonical')
    const verified = await createVerifiedBackup({ sourceDirectory, category: 'pre-migration', backupRoot, exclusiveConfirmed: true, now: options.now })
    folder = verified.folder; backupDirectory = verified.backupDirectory; sourceManifestAtBackup = verified.metadata.sourceManifest; backupManifest = verified.metadata.backupManifest
    verifiedBackupMetadataPath = join(folder, 'backup-metadata.json')
  } else {
    folder = join(backupRoot, `andalucia-pre-migration-${stamp}-${randomUUID().slice(0, 8)}`); backupDirectory = join(folder, 'postgres')
    ;({ sourceManifest: sourceManifestAtBackup, backupManifest } = await copyStoreVerified(sourceDirectory, backupDirectory))
  }
  if (!manifestsMatch(sourceManifestAtBackup, backupManifest)) throw new Error('LIVE_BACKUP_VERIFICATION_FAILED')
  const db = new PGlite(sourceDirectory); let fingerprint; let preflight
  try { fingerprint = await createMigrationFingerprint(db); preflight = await runPreflight(db, sourceDirectory) } finally { await db.close() }
  if (preflight.status !== 'READY') throw new Error(`LIVE_PREFLIGHT_BLOCKED:${preflight.blockers.join(',')}`)
  const preparedSourceManifest = await createStoreManifest(sourceDirectory)
  const artifactPath = join(folder, 'live-migration-authorization.json')
  const artifact: LiveMigrationAuthorizationArtifact = {
    artifactVersion, id: randomUUID(), state: 'prepared', createdAt: new Date().toISOString(), sourceDirectory, backupDirectory,
    sourceManifestAtBackup, backupManifest, preparedSourceManifest, sourceFingerprintDigest: fingerprint.digest,
    sourceBusinessSnapshot: fingerprint.business, preflightStatus: 'READY', migrationSet,
    rollbackInstructions: 'Keep the application stopped. Restore only by replacing the failed live store with this complete verified backup after explicit manager approval.',
    verifiedBackupMetadataPath
  }
  await writeJsonAtomic(artifactPath, artifact)
  return { artifactPath, artifact }
}

export const authorizeLiveExecution = async (options: {
  sourceDirectory: string
  expectedLiveStore?: string
  authorizationPhrase?: string
  artifactPath?: string
  exclusiveCheck?: () => Promise<boolean>
}) => {
  if (options.authorizationPhrase !== LIVE_MIGRATION_AUTHORIZATION_PHRASE && process.env.ANDALUCIA_ALLOW_LIVE_MIGRATION !== LIVE_MIGRATION_AUTHORIZATION_PHRASE) throw new Error('LIVE_MIGRATION_EXPLICIT_AUTHORIZATION_REQUIRED')
  if (!options.sourceDirectory || !isAbsolute(options.sourceDirectory)) throw new Error('MIGRATION_DATA_DIR_REQUIRED')
  const sourceDirectory = resolve(options.sourceDirectory); const expectedLiveStore = resolve(options.expectedLiveStore || liveStore)
  if (existsSync(operationMarkerPaths(sourceDirectory).recovery)) throw new Error('RECOVERY_IN_PROGRESS_OPERATION_BLOCKED')
  if (!isLiveStorePath(sourceDirectory, expectedLiveStore)) throw new Error('LIVE_MIGRATION_TARGET_PATH_MISMATCH')
  if (!(await (options.exclusiveCheck || defaultExclusiveAccessCheck)())) throw new Error('LIVE_STORE_NOT_EXCLUSIVE')
  const configuredArtifact = options.artifactPath || process.env.ANDALUCIA_LIVE_MIGRATION_AUTHORIZATION_FILE
  if (!configuredArtifact || !isAbsolute(configuredArtifact) || !existsSync(configuredArtifact)) throw new Error('LIVE_VERIFIED_BACKUP_ARTIFACT_REQUIRED')
  const artifactPath = resolve(configuredArtifact); const artifact = await readArtifact(artifactPath)
  const boundArtifact = artifact.artifactVersion === 'andalucia-live-migration-authorization-v2'
  if ((!boundArtifact && artifact.artifactVersion !== artifactVersion) || artifact.state !== 'prepared') throw new Error('LIVE_MIGRATION_AUTHORIZATION_STALE')
  if (boundArtifact ? (!artifact.expiresAt || Date.now() > Date.parse(artifact.expiresAt)) : Date.now() - Date.parse(artifact.createdAt) > 30 * 60 * 1000) throw new Error('LIVE_MIGRATION_AUTHORIZATION_STALE')
  if (isLiveStorePath(sourceDirectory, liveStore)) {
    await readStoreIdentity(sourceDirectory, 'canonical')
    if (!artifact.verifiedBackupMetadataPath) throw new Error('LIVE_VERIFIED_BACKUP_ARTIFACT_REQUIRED')
    await requireRecentVerifiedBackup({ metadataPath: artifact.verifiedBackupMetadataPath, sourceDirectory, maximumAgeMs: 30 * 60 * 1000, requireSourceManifestMatch: false })
  }
  const lockPath = `${artifactPath}.execution.lock`
  const schedulerBackupRoot = join(dirname(expectedLiveStore), '..', '.backups')
  if (schedulerJobBlocksMigration(schedulerBackupRoot)) throw new Error('DATABASE_SCHEDULER_JOB_IN_PROGRESS')
  let lock
  try { lock = await open(lockPath, 'wx') } catch { throw new Error('LIVE_MIGRATION_EXECUTION_ALREADY_IN_PROGRESS') }
  const migrationMarkerPath = operationMarkerPaths(sourceDirectory).migration
  let migrationMarker
  try { migrationMarker = await open(migrationMarkerPath, 'wx') } catch { await lock.close(); await unlink(lockPath).catch(() => undefined); throw new Error('LIVE_MIGRATION_EXECUTION_ALREADY_IN_PROGRESS') }
  const release = async () => { await migrationMarker.close(); await unlink(migrationMarkerPath).catch(() => undefined); await lock.close(); await unlink(lockPath).catch(() => undefined) }
  try {
  if (normalized(artifact.sourceDirectory) !== normalized(sourceDirectory)) throw new Error('LIVE_MIGRATION_ARTIFACT_SOURCE_MISMATCH')
  if (!existsSync(join(artifact.backupDirectory, 'PG_VERSION'))) throw new Error('LIVE_VERIFIED_BACKUP_ARTIFACT_REQUIRED')
  if (!manifestsMatch(artifact.sourceManifestAtBackup, artifact.backupManifest)) throw new Error('LIVE_BACKUP_VERIFICATION_FAILED')
  const backupNow = await createStoreManifest(artifact.backupDirectory)
  if (!manifestsMatch(backupNow, artifact.backupManifest)) throw new Error('LIVE_BACKUP_VERIFICATION_FAILED')
  const sourceNow = await createStoreManifest(sourceDirectory)
  if (!manifestsMatch(sourceNow, artifact.preparedSourceManifest)) throw new Error('LIVE_STORE_CHANGED_AFTER_BACKUP')
  const migrationSet = await reviewedMigrationSet()
  if (!sameJson(migrationSet, artifact.migrationSet)) throw new Error('LIVE_MIGRATION_REVIEWED_VERSION_SET_MISMATCH')
  const db = new PGlite(sourceDirectory)
  try {
    const fingerprint = await createMigrationFingerprint(db)
    if (fingerprint.digest !== artifact.sourceFingerprintDigest) throw new Error('LIVE_STORE_CHANGED_AFTER_BACKUP')
    const preflight = await runPreflight(db, sourceDirectory)
    if (preflight.status !== 'READY') throw new Error(`LIVE_PREFLIGHT_BLOCKED:${preflight.blockers.join(',')}`)
    if (boundArtifact) {
      const identity = await readStoreIdentity(sourceDirectory, 'canonical')
      if (!artifact.targetMigration || artifact.canonicalStoreId !== identity.storeId || artifact.outletScopeId !== '00000000-0000-4000-8000-00000000a001' || artifact.protectedBackup?.pinned !== true || artifact.protectedBackup.restoreRehearsal !== 'PASS' || artifact.rehearsal?.status !== 'PASS' || artifact.rehearsal.migratedSchema !== artifact.targetMigration.version) throw new Error('LIVE_MIGRATION_BOUND_EVIDENCE_MISMATCH')
      const status = await import('./migration-store.js').then(module => module.migrationStatus(db))
      const appliedVersions = status.migrations.filter(item => item.state === 'applied').map(item => item.version)
      if (!sameJson(status, artifact.sourceMigrationLedger) || status.migrations.find(item => item.version === artifact.targetMigration!.version)?.checksum !== artifact.targetMigration.checksum || status.migrations.find(item => item.version === artifact.targetMigration!.version)?.state !== 'pending' || artifact.rehearsal.rollbackSchema !== appliedVersions.at(-1)) throw new Error('LIVE_MIGRATION_BOUND_LEDGER_MISMATCH')
      const financial = await createFinancialFinalizationFingerprint(db)
      if (financial.digest !== artifact.sourceFinancialFingerprintDigest) throw new Error('LIVE_MIGRATION_BOUND_FINANCIAL_FINGERPRINT_MISMATCH')
      const owner = artifact.ownerSession
      const session = owner ? (await db.query<any>("select s.id,s.expires_at::text,u.id user_id,u.login_identifier,u.display_name from auth_sessions s join user_accounts u on u.id=s.user_id and u.status='active' join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true and r.role_key='owner' and r.global_scope=true where s.id=$1 and s.revoked_at is null and s.expires_at>now()", [owner.sessionId])).rows[0] : null
      if (!session || session.user_id !== owner!.userId || session.login_identifier !== owner!.loginIdentifier || session.display_name !== owner!.displayName || Date.parse(session.expires_at) < Date.parse(artifact.expiresAt!)) throw new Error('LIVE_MIGRATION_OWNER_SESSION_INVALID')
    }
    return { db, artifact, artifactPath, preflight, release }
  } catch (error) { await db.close(); throw error }
  } catch (error) { await release(); throw error }
}

export const consumeLiveAuthorization = async (artifactPath: string, postMigrationFingerprint: string) => {
  const artifact = await readArtifact(artifactPath)
  if (artifact.state !== 'prepared') throw new Error('LIVE_MIGRATION_AUTHORIZATION_STALE')
  await writeJsonAtomic(artifactPath, { ...artifact, state: 'consumed', consumedAt: new Date().toISOString(), consumedPostMigrationFingerprint: postMigrationFingerprint })
}
