import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, open, readFile, rename, rm, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { AuditActor, DatabaseHealthState } from '../src/domain.js'
import { createOperationalFingerprint, verifyBackupCopy } from './database-backup.js'
import { DatabaseBackupAdminService, type BackupInventoryItem } from './database-backup-admin.js'
import { canonicalStoreDirectory, operationMarkerPaths, readStoreIdentity, SUPPORTED_SCHEMA_VERSION, type DatabaseHealth } from './database-protection.js'
import { schedulerLockPath } from './database-scheduler.js'
import { copyStoreVerified, createStoreManifest, manifestsMatch, writeJsonAtomic, type StoreManifest } from './migration-filesystem.js'
import { migrationStatus, runPreflight } from './migration-store.js'

export const RECOVERY_PROMOTION_CONFIRMATION = 'YES_I_APPROVE_ANDALUCIA_RECOVERY_PROMOTION'
export const RECOVERY_PREPARATION_CONFIRMATION = 'YES_I_AUTHORIZE_ANDALUCIA_RECOVERY_PREPARATION'
export const RECOVERY_AUTHORIZATION_MAX_AGE_MS = 30 * 60_000
export type RecoveryFailureClass = 'DATABASE_RECOVERY_REQUIRED' | 'STORE_CONFIGURATION_ERROR' | 'STARTUP_INTEGRITY_FAILURE' | 'MIGRATION_INTEGRITY_FAILURE' | 'BACKUP_INVALID' | 'RESTORE_REHEARSAL_FAILED' | 'PROMOTION_VALIDATION_FAILED' | 'APPLICATION_RESTART_FAILED'
export type RecoveryIncidentState = 'RECOVERY_REQUIRED' | 'CANDIDATE_SELECTED' | 'REHEARSAL_PASSED' | 'AUTHORIZED' | 'PROMOTION_IN_PROGRESS' | 'RECOVERY_PROMOTED_AWAITING_ACCEPTANCE' | 'RECOVERY_ACCEPTED' | 'ROLLBACK_COMPLETED' | 'RECOVERY_FAILED'
type Fingerprint = Record<string, any>
type Gap = { area: string; latestKnown: unknown; candidate: unknown; changed: boolean; material: boolean }
export type RecoveryIncident = {
  version: 'andalucia-recovery-incident-v1'; id: string; detectedAt: string; failureClass: RecoveryFailureClass; state: RecoveryIncidentState
  canonical: { storeId: string; expectedDirectory: string; healthState: DatabaseHealthState; recoveryRequired: boolean }
  latestHealthyFingerprint: Fingerprint | null; candidateBackupIds: string[]; selectedBackupId: string | null; gapAnalysis: Gap[]
  rehearsal: null | { status: 'RESTORE_TEST_PASSED' | 'RESTORE_TEST_FAILED'; backupId: string; completedAt: string; manifestSha256: string; error?: string }
  authorization: null | { id: string; state: 'prepared' | 'consumed' | 'expired'; createdAt: string; expiresAt: string; artifactFile: string }
  promotion: null | { status: 'completed' | 'failed'; completedAt: string; quarantineId?: string; fingerprintMatch?: boolean; error?: string }
  rollback: null | { status: 'completed' | 'failed'; completedAt: string; backupId: string; error?: string }
  acceptedAt: string | null; acceptedBy: AuditActor | null; completedAt: string | null
}
export type RecoveryAuthorization = {
  version: 'andalucia-recovery-authorization-v1'; id: string; state: 'prepared' | 'consumed'; incidentId: string; canonicalStoreId: string
  canonicalDirectory: string; canonicalManifestAtAuthorization: StoreManifest | null; selectedBackupId: string; selectedBackupManifest: StoreManifest
  selectedFingerprintDigest: string; rehearsalCompletedAt: string; expectedPromotionTarget: string; actor: AuditActor; createdAt: string; expiresAt: string
  rollbackBackupId: string; instructions: string; consumedAt?: string
}
type BackupMetadata = { backupId: string; category: string; createdAt: string; verificationStatus: string; openTestStatus: string; preflightStatus: string; schemaVersion: string; backupDirectory: string; backupManifest: StoreManifest; operationalFingerprint: Fingerprint; migrationLedger: unknown }

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (key, item) => key === 'generatedAt' ? undefined : item)).digest('hex')
const same = (left: unknown, right: unknown) => digest(left) === digest(right)
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500)
const systemActor = { userId: 'system', displayName: 'ANDALUCÍA recovery detection' }
const gapValue = (fingerprint: Fingerprint | null, area: string) => fingerprint?.[area] ?? null
const gapAreas = ['staff', 'membership', 'roster', 'bookings', 'occasions', 'chargeables', 'maintenance', 'training', 'financial', 'owner', 'outlet', 'migration']

export class DatabaseRecoveryService {
  readonly recoveryRoot: string
  readonly incidentsRoot: string
  readonly expectedCanonicalDirectory: string
  readonly backupAdmin: DatabaseBackupAdminService
  constructor(options: { recoveryRoot: string; backupRoot: string; canonicalDirectory: string; expectedCanonicalDirectory?: string }) {
    this.recoveryRoot = resolve(options.recoveryRoot); this.incidentsRoot = join(this.recoveryRoot, 'incidents'); this.expectedCanonicalDirectory = resolve(options.expectedCanonicalDirectory || canonicalStoreDirectory)
    if (resolve(options.canonicalDirectory) !== this.expectedCanonicalDirectory) throw new Error('RECOVERY_CANONICAL_TARGET_MISMATCH')
    this.backupAdmin = new DatabaseBackupAdminService(resolve(options.backupRoot), this.expectedCanonicalDirectory)
  }
  private incidentFile(id: string) { if (basename(id) !== id || id.includes('..')) throw new Error('RECOVERY_INCIDENT_ID_INVALID'); return join(this.incidentsRoot, id, 'incident.json') }
  private async readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T }
  private async writeIncident(incident: RecoveryIncident) { await writeJsonAtomic(this.incidentFile(incident.id), incident); return incident }
  private async audit(action: string, actor: AuditActor, incidentId: string, details: Record<string, unknown> = {}) { await mkdir(this.recoveryRoot, { recursive: true }); await appendFile(join(this.recoveryRoot, 'recovery-audit.jsonl'), `${JSON.stringify({ id: randomUUID(), occurredAt: new Date().toISOString(), action, incidentId, actor, details })}\n`, 'utf8') }
  async incident(id: string) { return this.readJson<RecoveryIncident>(this.incidentFile(id)) }
  async history() {
    if (!existsSync(this.incidentsRoot)) return [] as RecoveryIncident[]
    const { readdir } = await import('node:fs/promises'); const result: RecoveryIncident[] = []
    for (const entry of await readdir(this.incidentsRoot, { withFileTypes: true })) if (entry.isDirectory() && existsSync(this.incidentFile(entry.name))) result.push(await this.incident(entry.name))
    return result.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
  }
  async detect(options: { failureClass: RecoveryFailureClass; health: DatabaseHealth; latestHealthyFingerprint?: Fingerprint | null }) {
    if (!options.health.recoveryRequired && !['DATABASE_RECOVERY_REQUIRED', 'STARTUP_INTEGRITY_FAILURE', 'MIGRATION_INTEGRITY_FAILURE'].includes(options.failureClass)) throw new Error('RECOVERY_INCIDENT_REQUIRES_RECOVERY_CONDITION')
    const candidates = await this.discoverCandidates()
    const incident: RecoveryIncident = { version: 'andalucia-recovery-incident-v1', id: `recovery-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}-${randomUUID().slice(0, 8)}`, detectedAt: new Date().toISOString(), failureClass: options.failureClass, state: 'RECOVERY_REQUIRED', canonical: { storeId: options.health.storeId, expectedDirectory: this.expectedCanonicalDirectory, healthState: options.health.status, recoveryRequired: true }, latestHealthyFingerprint: options.latestHealthyFingerprint || null, candidateBackupIds: candidates.map(item => item.backupId), selectedBackupId: null, gapAnalysis: [], rehearsal: null, authorization: null, promotion: null, rollback: null, acceptedAt: null, acceptedBy: null, completedAt: null }
    await this.writeIncident(incident); await this.audit('recovery_detected', systemActor, incident.id, { failureClass: options.failureClass }); return incident
  }
  async discoverCandidates() { const inventory = await this.backupAdmin.inventory(); return this.backupAdmin.rankRecoveryCandidates(inventory).filter(item => item.verificationStatus === 'VERIFIED' && item.schemaVersion === SUPPORTED_SCHEMA_VERSION && Boolean(item.operationalFingerprint)) }
  private gaps(latest: Fingerprint | null, candidate: Fingerprint): Gap[] { return gapAreas.map(area => { const before = gapValue(latest, area); const after = gapValue(candidate, area); const changed = latest ? !same(before, after) : false; return { area, latestKnown: before, candidate: after, changed, material: changed } }) }
  async selectCandidate(incidentId: string, backupId: string, actor: AuditActor) {
    const incident = await this.incident(incidentId); const candidate = (await this.discoverCandidates()).find(item => item.backupId === backupId)
    if (!candidate) throw new Error('RECOVERY_CANDIDATE_NOT_ELIGIBLE')
    await this.audit('recovery_candidate_inspected', actor, incident.id, { backupId })
    incident.selectedBackupId = backupId; incident.gapAnalysis = this.gaps(incident.latestHealthyFingerprint, candidate.operationalFingerprint as Fingerprint); incident.state = 'CANDIDATE_SELECTED'; incident.rehearsal = null; incident.authorization = null
    await this.writeIncident(incident); await this.audit('recovery_candidate_selected', actor, incident.id, { backupId }); return this.preview(incident.id)
  }
  async preview(incidentId: string) {
    const incident = await this.incident(incidentId); const candidate = incident.selectedBackupId ? (await this.backupAdmin.inventory()).find(item => item.backupId === incident.selectedBackupId) || null : null
    return { incident, canonicalHealth: incident.canonical, selectedCandidate: candidate ? { backupId: candidate.backupId, createdAt: candidate.createdAt, category: candidate.category, schemaVersion: candidate.schemaVersion, verificationStatus: candidate.verificationStatus, restoreTestStatus: candidate.restoreTestStatus, protected: candidate.protected } : null, gaps: incident.gapAnalysis, materialGapCount: incident.gapAnalysis.filter(item => item.material).length }
  }
  private async metadata(backupId: string) { const folder = join(this.backupAdmin.backupRoot, backupId); const metadata = await this.readJson<BackupMetadata>(join(folder, 'backup-metadata.json')); if (metadata.backupId !== backupId || metadata.verificationStatus !== 'VERIFIED' || metadata.openTestStatus !== 'PASS' || metadata.preflightStatus !== 'READY' || metadata.schemaVersion !== SUPPORTED_SCHEMA_VERSION || !metadata.operationalFingerprint) throw new Error('RECOVERY_CANDIDATE_NOT_ELIGIBLE'); const current = await createStoreManifest(metadata.backupDirectory); if (!manifestsMatch(current, metadata.backupManifest)) throw new Error('RECOVERY_CANDIDATE_MANIFEST_MISMATCH'); return metadata }
  async rehearse(incidentId: string, actor: AuditActor) {
    const incident = await this.incident(incidentId); if (!incident.selectedBackupId) throw new Error('RECOVERY_CANDIDATE_REQUIRED')
    const metadata = await this.metadata(incident.selectedBackupId); await this.audit('recovery_rehearsal_started', actor, incident.id, { backupId: incident.selectedBackupId })
    try { const result = await this.backupAdmin.rehearse(incident.selectedBackupId, actor); incident.rehearsal = { status: 'RESTORE_TEST_PASSED', backupId: incident.selectedBackupId, completedAt: result.completedAt, manifestSha256: metadata.backupManifest.aggregateSha256 }; incident.state = 'REHEARSAL_PASSED'; await this.writeIncident(incident); await this.audit('recovery_rehearsal_completed', actor, incident.id, { backupId: incident.selectedBackupId }); return incident }
    catch (error) { incident.rehearsal = { status: 'RESTORE_TEST_FAILED', backupId: incident.selectedBackupId, completedAt: new Date().toISOString(), manifestSha256: metadata.backupManifest.aggregateSha256, error: errorText(error) }; incident.state = 'RECOVERY_FAILED'; await this.writeIncident(incident); await this.audit('recovery_rehearsal_failed', actor, incident.id, { error: errorText(error) }); throw error }
  }
  async authorize(incidentId: string, input: { confirmation: string; rollbackBackupId: string }, actor: AuditActor) {
    if (input.confirmation !== RECOVERY_PREPARATION_CONFIRMATION) throw new Error('RECOVERY_PREPARATION_EXPLICIT_CONFIRMATION_REQUIRED')
    const incident = await this.incident(incidentId); if (incident.state !== 'REHEARSAL_PASSED' || incident.rehearsal?.status !== 'RESTORE_TEST_PASSED' || !incident.selectedBackupId) throw new Error('FRESH_RECOVERY_REHEARSAL_REQUIRED')
    const selected = await this.metadata(incident.selectedBackupId); await this.metadata(input.rollbackBackupId); const identity = await readStoreIdentity(this.expectedCanonicalDirectory, 'canonical')
    const createdAt = new Date().toISOString(); const expiresAt = new Date(Date.parse(createdAt) + RECOVERY_AUTHORIZATION_MAX_AGE_MS).toISOString(); const canonicalManifest = existsSync(this.expectedCanonicalDirectory) ? await createStoreManifest(this.expectedCanonicalDirectory) : null
    const authorization: RecoveryAuthorization = { version: 'andalucia-recovery-authorization-v1', id: randomUUID(), state: 'prepared', incidentId, canonicalStoreId: identity.storeId, canonicalDirectory: this.expectedCanonicalDirectory, canonicalManifestAtAuthorization: canonicalManifest, selectedBackupId: selected.backupId, selectedBackupManifest: selected.backupManifest, selectedFingerprintDigest: digest(selected.operationalFingerprint), rehearsalCompletedAt: incident.rehearsal.completedAt, expectedPromotionTarget: this.expectedCanonicalDirectory, actor: { userId: actor.userId, displayName: actor.displayName }, createdAt, expiresAt, rollbackBackupId: input.rollbackBackupId, instructions: 'Keep services stopped. Preserve quarantine. Promote only this exact verified candidate with the offline recovery CLI and explicit phrase.' }
    const artifactFile = join(dirname(this.incidentFile(incident.id)), `authorization-${authorization.id}.json`); await writeJsonAtomic(artifactFile, authorization); incident.authorization = { id: authorization.id, state: 'prepared', createdAt, expiresAt, artifactFile }; incident.state = 'AUTHORIZED'; await this.writeIncident(incident); await this.audit('recovery_authorization_created', actor, incident.id, { authorizationId: authorization.id, selectedBackupId: selected.backupId }); return { incident, authorization: { ...authorization, canonicalDirectory: '[protected]', expectedPromotionTarget: '[protected]' } }
  }
  private async acquireRecoveryLock(incidentId: string, adoptExistingMarker = false) {
    const lockPath = join(this.recoveryRoot, 'recovery.lock'); const markerPath = operationMarkerPaths(this.expectedCanonicalDirectory).recovery
    if (existsSync(schedulerLockPath(this.backupAdmin.backupRoot))) throw new Error('RECOVERY_BLOCKED_BY_SCHEDULER_JOB')
    await mkdir(this.recoveryRoot, { recursive: true }); let lock; let marker: Awaited<ReturnType<typeof open>> | null = null
    try { lock = await open(lockPath, 'wx') } catch { throw new Error('RECOVERY_ALREADY_IN_PROGRESS') }
    try { marker = await open(markerPath, 'wx') } catch {
      if (!adoptExistingMarker || !existsSync(markerPath) || !(await readFile(markerPath, 'utf8')).includes(`incident=${incidentId}`)) { await lock.close(); await unlink(lockPath).catch(() => undefined); throw new Error('RECOVERY_ALREADY_IN_PROGRESS') }
    }
    await lock.writeFile(JSON.stringify({ incidentId, startedAt: new Date().toISOString(), pid: process.pid })); if (marker) await marker.writeFile(`incident=${incidentId}`)
    return { async release(clearMarker: boolean) { if (marker) await marker.close(); if (clearMarker) await unlink(markerPath).catch(() => undefined); await lock.close(); await unlink(lockPath).catch(() => undefined) } }
  }
  async promoteOffline(input: { artifactFile: string; confirmation: string; exclusiveCheck: () => Promise<boolean>; simulateFailure?: 'promotion' | 'restart' }) {
    if (input.confirmation !== RECOVERY_PROMOTION_CONFIRMATION) throw new Error('RECOVERY_PROMOTION_EXPLICIT_CONFIRMATION_REQUIRED')
    if (!(await input.exclusiveCheck())) throw new Error('RECOVERY_REQUIRES_OFFLINE_EXCLUSIVE_ACCESS')
    const artifact = await this.readJson<RecoveryAuthorization>(resolve(input.artifactFile)); if (artifact.version !== 'andalucia-recovery-authorization-v1' || artifact.state !== 'prepared') throw new Error('RECOVERY_AUTHORIZATION_INVALID_OR_CONSUMED')
    if (Date.now() > Date.parse(artifact.expiresAt)) throw new Error('RECOVERY_AUTHORIZATION_EXPIRED')
    if (resolve(artifact.expectedPromotionTarget) !== this.expectedCanonicalDirectory || resolve(artifact.canonicalDirectory) !== this.expectedCanonicalDirectory) throw new Error('RECOVERY_PROMOTION_TARGET_MISMATCH')
    const incident = await this.incident(artifact.incidentId); if (incident.state !== 'AUTHORIZED' || incident.authorization?.id !== artifact.id || incident.selectedBackupId !== artifact.selectedBackupId) throw new Error('RECOVERY_AUTHORIZATION_INCIDENT_MISMATCH')
    const selected = await this.metadata(artifact.selectedBackupId); if (!manifestsMatch(selected.backupManifest, artifact.selectedBackupManifest) || digest(selected.operationalFingerprint) !== artifact.selectedFingerprintDigest || incident.rehearsal?.completedAt !== artifact.rehearsalCompletedAt) throw new Error('RECOVERY_AUTHORIZATION_BOUND_STATE_CHANGED')
    if (artifact.canonicalManifestAtAuthorization && (!existsSync(this.expectedCanonicalDirectory) || !manifestsMatch(await createStoreManifest(this.expectedCanonicalDirectory), artifact.canonicalManifestAtAuthorization))) throw new Error('RECOVERY_CANONICAL_STATE_CHANGED_AFTER_AUTHORIZATION')
    const lock = await this.acquireRecoveryLock(incident.id); const stageRoot = join(this.recoveryRoot, 'staging', `${incident.id}-${randomUUID()}`); const stage = join(stageRoot, 'postgres'); const verify = join(stageRoot, 'verification', 'postgres'); const quarantineId = `${incident.id}-original-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}`; const quarantine = join(this.recoveryRoot, 'quarantine', quarantineId, 'postgres'); let canonicalMoved = false; let restored = false
    incident.state = 'PROMOTION_IN_PROGRESS'; await this.writeIncident(incident); await this.audit('recovery_promotion_started', artifact.actor, incident.id, { backupId: selected.backupId })
    try {
      await copyStoreVerified(selected.backupDirectory, stage); const verified = await verifyBackupCopy({ backupDirectory: stage, sourceManifest: selected.backupManifest, verificationDirectory: verify }); await rm(join(stageRoot, 'verification'), { recursive: true, force: true }); if (!same(verified.fingerprint, selected.operationalFingerprint)) throw new Error('PROMOTION_STAGING_FINGERPRINT_MISMATCH')
      if (input.simulateFailure === 'promotion') throw new Error('SIMULATED_PROMOTION_FAILURE')
      if (existsSync(this.expectedCanonicalDirectory)) { await mkdir(dirname(quarantine), { recursive: true }); await rename(this.expectedCanonicalDirectory, quarantine); canonicalMoved = true; const quarantineManifest = await createStoreManifest(quarantine); if (artifact.canonicalManifestAtAuthorization && !manifestsMatch(quarantineManifest, artifact.canonicalManifestAtAuthorization)) throw new Error('RECOVERY_QUARANTINE_MANIFEST_MISMATCH'); await writeJsonAtomic(join(dirname(quarantine), 'quarantine-manifest.json'), quarantineManifest); await this.audit('recovery_canonical_quarantined', artifact.actor, incident.id, { quarantineId }) }
      await rename(stage, this.expectedCanonicalDirectory); const promotedManifest = await createStoreManifest(this.expectedCanonicalDirectory); if (!manifestsMatch(promotedManifest, selected.backupManifest)) throw new Error('PROMOTION_MANIFEST_MISMATCH')
      const db = new PGlite(this.expectedCanonicalDirectory); let fingerprint: Fingerprint
      try { await db.query('select 1'); const preflight = await runPreflight(db, this.expectedCanonicalDirectory); if (preflight.status !== 'READY') throw new Error(`PROMOTION_PREFLIGHT_FAILED:${preflight.blockers.join(',')}`); const migration = await migrationStatus(db); if (migration.migrations.filter(item => item.state === 'applied').at(-1)?.version !== selected.schemaVersion) throw new Error('PROMOTION_MIGRATION_MISMATCH'); fingerprint = await createOperationalFingerprint(db) } finally { await db.close() }
      if (!same(fingerprint, selected.operationalFingerprint)) throw new Error('PROMOTION_RECONCILIATION_FAILED')
      if (input.simulateFailure === 'restart') throw new Error('SIMULATED_APPLICATION_RESTART_FAILURE')
      artifact.state = 'consumed'; artifact.consumedAt = new Date().toISOString(); await writeJsonAtomic(resolve(input.artifactFile), artifact); incident.authorization = { ...incident.authorization!, state: 'consumed' }; incident.state = 'RECOVERY_PROMOTED_AWAITING_ACCEPTANCE'; incident.promotion = { status: 'completed', completedAt: new Date().toISOString(), quarantineId, fingerprintMatch: true }; await this.writeIncident(incident); await this.audit('recovery_promotion_completed', artifact.actor, incident.id, { quarantineId }); await rm(stageRoot, { recursive: true, force: true }); await lock.release(true); return incident
    } catch (error) {
      if (canonicalMoved && !existsSync(this.expectedCanonicalDirectory) && existsSync(quarantine)) { await rename(quarantine, this.expectedCanonicalDirectory); restored = true }
      incident.state = 'RECOVERY_FAILED'; incident.promotion = { status: 'failed', completedAt: new Date().toISOString(), quarantineId: canonicalMoved ? quarantineId : undefined, error: errorText(error) }; await this.writeIncident(incident); await this.audit('recovery_promotion_failed', artifact.actor, incident.id, { error: errorText(error), canonicalRestored: restored }); await rm(stageRoot, { recursive: true, force: true }).catch(() => undefined); await lock.release(!canonicalMoved || restored); throw error
    }
  }
  async rollbackOffline(input: { incidentId: string; confirmation: string; exclusiveCheck: () => Promise<boolean>; simulateFailure?: boolean }) {
    if (input.confirmation !== RECOVERY_PROMOTION_CONFIRMATION || !(await input.exclusiveCheck())) throw new Error('RECOVERY_ROLLBACK_EXPLICIT_OFFLINE_CONFIRMATION_REQUIRED')
    const incident = await this.incident(input.incidentId); if (!incident.authorization) throw new Error('RECOVERY_AUTHORIZATION_REQUIRED'); const artifact = await this.readJson<RecoveryAuthorization>(incident.authorization.artifactFile); const rollback = await this.metadata(artifact.rollbackBackupId); const lock = await this.acquireRecoveryLock(incident.id, true); const stageRoot = join(this.recoveryRoot, 'rollback-staging', `${incident.id}-${randomUUID()}`); const stage = join(stageRoot, 'postgres'); const failedPromotionId = `${incident.id}-failed-promotion-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}`; const failedPromotion = join(this.recoveryRoot, 'quarantine', failedPromotionId, 'postgres')
    await this.audit('recovery_rollback_started', artifact.actor, incident.id, { backupId: rollback.backupId })
    try { await copyStoreVerified(rollback.backupDirectory, stage); if (input.simulateFailure) throw new Error('SIMULATED_ROLLBACK_FAILURE'); if (existsSync(this.expectedCanonicalDirectory)) { await mkdir(dirname(failedPromotion), { recursive: true }); await rename(this.expectedCanonicalDirectory, failedPromotion); await writeJsonAtomic(join(dirname(failedPromotion), 'quarantine-manifest.json'), await createStoreManifest(failedPromotion)) }; await rename(stage, this.expectedCanonicalDirectory); if (!manifestsMatch(await createStoreManifest(this.expectedCanonicalDirectory), rollback.backupManifest)) throw new Error('ROLLBACK_MANIFEST_MISMATCH'); const db = new PGlite(this.expectedCanonicalDirectory); let fingerprint; try { await db.query('select 1'); const preflight = await runPreflight(db, this.expectedCanonicalDirectory); if (preflight.status !== 'READY') throw new Error(`ROLLBACK_PREFLIGHT_FAILED:${preflight.blockers.join(',')}`); const migration = await migrationStatus(db); if (migration.migrations.filter(item => item.state === 'applied').at(-1)?.version !== rollback.schemaVersion) throw new Error('ROLLBACK_MIGRATION_MISMATCH'); fingerprint = await createOperationalFingerprint(db) } finally { await db.close() }; if (!same(fingerprint, rollback.operationalFingerprint)) throw new Error('ROLLBACK_RECONCILIATION_FAILED'); incident.state = 'ROLLBACK_COMPLETED'; incident.rollback = { status: 'completed', completedAt: new Date().toISOString(), backupId: rollback.backupId }; incident.completedAt = new Date().toISOString(); await this.writeIncident(incident); await this.audit('recovery_rollback_completed', artifact.actor, incident.id, { backupId: rollback.backupId }); await rm(stageRoot, { recursive: true, force: true }); await lock.release(true); return incident }
    catch (error) { incident.state = 'RECOVERY_FAILED'; incident.rollback = { status: 'failed', completedAt: new Date().toISOString(), backupId: rollback.backupId, error: errorText(error) }; await this.writeIncident(incident); await this.audit('recovery_rollback_failed', artifact.actor, incident.id, { error: errorText(error) }); await rm(stageRoot, { recursive: true, force: true }).catch(() => undefined); await lock.release(false); throw error }
  }
  async accept(incidentId: string, actor: AuditActor, currentFingerprint: Fingerprint) { const incident = await this.incident(incidentId); if (incident.state !== 'RECOVERY_PROMOTED_AWAITING_ACCEPTANCE' || !incident.selectedBackupId) throw new Error('RECOVERY_NOT_AWAITING_ACCEPTANCE'); const selected = await this.metadata(incident.selectedBackupId); if (!same(currentFingerprint, selected.operationalFingerprint)) throw new Error('RECOVERY_ACCEPTANCE_RECONCILIATION_FAILED'); incident.state = 'RECOVERY_ACCEPTED'; incident.acceptedAt = new Date().toISOString(); incident.acceptedBy = actor; incident.completedAt = incident.acceptedAt; await this.writeIncident(incident); await this.audit('recovery_accepted', actor, incident.id); return incident }
  async summary(database: DatabaseHealth) { const history = await this.history(); const active = history.find(item => !['RECOVERY_ACCEPTED', 'ROLLBACK_COMPLETED'].includes(item.state)) || null; const candidates = active ? await this.discoverCandidates() : []; return { required: database.recoveryRequired, activeIncident: active, candidates: candidates.map(item => ({ backupId: item.backupId, createdAt: item.createdAt, category: item.category, schemaVersion: item.schemaVersion, verificationStatus: item.verificationStatus, restoreTestStatus: item.restoreTestStatus, protected: item.protected, recoveryScore: item.recoveryScore })), history: history.map(item => ({ id: item.id, detectedAt: item.detectedAt, failureClass: item.failureClass, state: item.state, selectedBackupId: item.selectedBackupId, rehearsalStatus: item.rehearsal?.status || null, promotionStatus: item.promotion?.status || null, rollbackStatus: item.rollback?.status || null, acceptedAt: item.acceptedAt, acceptedBy: item.acceptedBy?.displayName || null })) } }
}

export const recoveryActive = (canonicalDirectory = canonicalStoreDirectory, recoveryRoot = resolve('.recovery')) => existsSync(operationMarkerPaths(canonicalDirectory).recovery) || existsSync(join(resolve(recoveryRoot), 'recovery.lock'))
export const assertRecoveryInactive = (canonicalDirectory = canonicalStoreDirectory, recoveryRoot = resolve('.recovery')) => { if (recoveryActive(canonicalDirectory, recoveryRoot)) throw new Error('RECOVERY_IN_PROGRESS_OPERATION_BLOCKED') }
