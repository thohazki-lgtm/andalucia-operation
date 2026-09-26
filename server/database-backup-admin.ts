import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { AuditActor } from '../src/domain.js'
import { setBackupOriginalFilesystemProtection, verifyBackupCopy, type BackupCategory } from './database-backup.js'
import { operationMarkerPaths, SUPPORTED_SCHEMA_VERSION, type DatabaseHealth, type VerifiedBackupSummary } from './database-protection.js'
import { createStoreManifest, manifestsMatch, writeJsonAtomic } from './migration-filesystem.js'

export type BackupRestoreStatus = 'RESTORE_TEST_PENDING' | 'RESTORE_TEST_PASSED' | 'RESTORE_TEST_FAILED'
export type BackupInventoryItem = {
  backupId: string; category: string; createdAt: string; verificationStatus: 'VERIFIED' | 'INVALID' | 'VERIFYING'
  schemaVersion: string; sizeBytes: number; protected: boolean; protectionReasons: string[]
  restoreTestStatus: BackupRestoreStatus; latestRestoreTestAt: string | null; operationalFingerprint: Record<string, unknown> | null; financialFinalizationFingerprint: Record<string, unknown> | null
}
export type BackupPolicy = {
  version: 'andalucia-db2-policy-v1'; backupAgeWarningHours: number; restoreRehearsalIntervalDays: number
  retention: { daily: number; weekly: number }; schedule: { dailyLocalTime: string; weeklyDay: string; weeklyLocalTime: string; restoreWeeklyDay: string; restoreLocalTime: string }
}
type Protection = { pinned: boolean; reason: string; updatedAt: string; updatedBy: string }
type RestoreResult = { status: BackupRestoreStatus; startedAt: string; completedAt: string; backupId: string; manifestMatch: boolean; fingerprintMatch: boolean; migrationMatch: boolean; preflightStatus: string; error?: string }
type BackupMetadata = VerifiedBackupSummary & { schemaVersion?: string; migrationLedger?: unknown; operationalFingerprint?: Record<string, unknown>; financialFinalizationFingerprint?: Record<string, unknown> }
type AuditEvent = { id: string; occurredAt: string; action: string; backupId?: string; actor: { source: 'authenticated_user' | 'system_job'; userId: string | null; displayName: string }; details?: Record<string, unknown> }

export const defaultBackupPolicy: BackupPolicy = {
  version: 'andalucia-db2-policy-v1', backupAgeWarningHours: 24, restoreRehearsalIntervalDays: 7,
  retention: { daily: 7, weekly: 8 },
  schedule: { dailyLocalTime: '02:00', weeklyDay: 'Sunday', weeklyLocalTime: '02:30', restoreWeeklyDay: 'Sunday', restoreLocalTime: '03:30' }
}
const comparable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(comparable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== 'generatedAt').map(([key, item]) => [key, comparable(item)]))
  return value
}
const same = (left: unknown, right: unknown) => JSON.stringify(comparable(left)) === JSON.stringify(comparable(right))
const safeError = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500)
const systemActor = { source: 'system_job' as const, userId: null, displayName: 'ANDALUCÍA DB-2 automated job' }

export class DatabaseBackupAdminService {
  readonly adminRoot: string
  constructor(readonly backupRoot: string, readonly canonicalDirectory: string) { this.backupRoot = resolve(backupRoot); this.canonicalDirectory = resolve(canonicalDirectory); this.adminRoot = join(this.backupRoot, '.db2') }
  private async json<T>(path: string): Promise<T | null> { try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return null } }
  private folder(backupId: string) { if (basename(backupId) !== backupId || backupId.includes('..')) throw new Error('BACKUP_ID_INVALID'); return join(this.backupRoot, backupId) }
  private async audit(action: string, actor: AuditEvent['actor'], backupId?: string, details?: Record<string, unknown>) { await mkdir(this.adminRoot, { recursive: true }); await appendFile(join(this.adminRoot, 'audit.jsonl'), `${JSON.stringify({ id: randomUUID(), occurredAt: new Date().toISOString(), action, backupId, actor, details } satisfies AuditEvent)}\n`, 'utf8') }
  actor(actor?: AuditActor) { return actor ? { source: 'authenticated_user' as const, userId: actor.userId, displayName: actor.displayName } : systemActor }
  async policy() { const stored = await this.json<Partial<BackupPolicy>>(join(this.adminRoot, 'policy.json')); return { ...defaultBackupPolicy, ...stored, retention: { ...defaultBackupPolicy.retention, ...stored?.retention }, schedule: { ...defaultBackupPolicy.schedule, ...stored?.schedule } } as BackupPolicy }
  async ensurePolicy() { const policy = await this.policy(); if (!existsSync(join(this.adminRoot, 'policy.json'))) await writeJsonAtomic(join(this.adminRoot, 'policy.json'), policy); return policy }
  private async metadataFolders() { if (!existsSync(this.backupRoot)) return [] as string[]; return (await readdir(this.backupRoot, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name) }
  async inventory(): Promise<BackupInventoryItem[]> {
    const folders = await this.metadataFolders(); const records: Array<{ item: BackupInventoryItem; metadata: BackupMetadata | null }> = []
    for (const name of folders) {
      const folder = this.folder(name); const metadata = await this.json<BackupMetadata>(join(folder, 'backup-metadata.json')); const failure = await this.json<{ createdAt?: string }>(join(folder, 'backup-failure.json'))
      if (!metadata && !failure) continue
      const protection = await this.json<Protection>(join(folder, 'db2-protection.json')); const restore = await this.json<RestoreResult>(join(folder, 'restore-test.json'))
      const verified = metadata?.verificationStatus === 'VERIFIED' && metadata.openTestStatus === 'PASS' && metadata.preflightStatus === 'READY'
      records.push({ metadata, item: {
        backupId: metadata?.backupId || name, category: metadata?.category || 'unknown', createdAt: metadata?.createdAt || failure?.createdAt || '', verificationStatus: verified ? 'VERIFIED' : 'INVALID',
        schemaVersion: metadata?.schemaVersion || 'unknown', sizeBytes: Number(metadata?.backupManifest?.bytes || 0), protected: Boolean(protection?.pinned), protectionReasons: protection?.pinned ? [protection.reason] : [],
        restoreTestStatus: restore?.status || 'RESTORE_TEST_PENDING', latestRestoreTestAt: restore?.completedAt || null, operationalFingerprint: metadata?.operationalFingerprint || null, financialFinalizationFingerprint: metadata?.financialFinalizationFingerprint || null
      } })
    }
    const sorted = records.sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt))
    const latestByCategory = (category: string) => sorted.find(record => record.item.category === category && record.item.verificationStatus === 'VERIFIED')?.item.backupId
    const latestPreMigration = latestByCategory('pre-migration'); const latestRecovery = latestByCategory('recovery')
    for (const record of sorted) {
      const reasons = record.item.protectionReasons
      if (['post-db1-protection-baseline', 'post-recovery-baseline', 'post-stale-marker-recovery'].includes(record.item.category)) reasons.push('Accepted recovery baseline')
      if (record.item.backupId === latestPreMigration) reasons.push('Latest pre-migration rollback point')
      if (record.item.backupId === latestRecovery) reasons.push('Latest recovery backup')
      if (record.item.category === 'pre-migration') reasons.push('Migration rollback evidence')
      if (record.item.category === 'recovery') reasons.push('Recovery evidence')
      record.item.protectionReasons = [...new Set(reasons)]; record.item.protected = record.item.protectionReasons.length > 0
    }
    return sorted.map(record => record.item)
  }
  async storage() { const items = await this.inventory(); const verified = items.filter(item => item.verificationStatus === 'VERIFIED'); return { totalBackupStorageBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0), backupCount: items.length, verifiedBackupCount: verified.length, oldestVerifiedAt: verified.at(-1)?.createdAt || null, newestVerifiedAt: verified[0]?.createdAt || null } }
  async pin(backupId: string, pinned: boolean, actor?: AuditActor, reason = '') {
    const item = (await this.inventory()).find(candidate => candidate.backupId === backupId); if (!item) throw new Error('BACKUP_NOT_FOUND')
    const folder = this.folder(backupId); const metadata = await this.json<BackupMetadata>(join(folder, 'backup-metadata.json')); if (!metadata || metadata.verificationStatus !== 'VERIFIED') throw new Error('VERIFIED_BACKUP_REQUIRED')
    const current = await this.json<Protection>(join(folder, 'db2-protection.json')); const automaticReasons = item.protectionReasons.filter(value => value !== current?.reason); if (!pinned && automaticReasons.length) throw new Error('BACKUP_PROTECTION_REQUIRED')
    const filesystem = await setBackupOriginalFilesystemProtection(metadata.backupDirectory, pinned)
    await writeJsonAtomic(join(folder, 'db2-protection.json'), { pinned, reason: pinned ? (reason.trim() || 'Owner protected backup') : '', updatedAt: new Date().toISOString(), updatedBy: actor?.displayName || systemActor.displayName, filesystem } satisfies Protection & { filesystem: unknown })
    await this.audit(pinned ? 'backup_pinned' : 'backup_unpinned', this.actor(actor), backupId, { filesystem })
    return (await this.inventory()).find(candidate => candidate.backupId === backupId)!
  }
  async requestManualBackup(actor: AuditActor) { const id = `backup-request-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}-${randomUUID().slice(0, 8)}`; const request = { id, category: 'manual', state: 'pending', requestedAt: new Date().toISOString(), requestedBy: { userId: actor.userId, displayName: actor.displayName }, instruction: 'Process only during a confirmed offline window with db:backup:job requested.' }; await writeJsonAtomic(join(this.adminRoot, 'requests', `${id}.json`), request); await this.audit('manual_backup_requested', this.actor(actor), undefined, { requestId: id }); return request }
  async inspect(backupId: string, actor: AuditActor) { const item = (await this.inventory()).find(candidate => candidate.backupId === backupId); if (!item) throw new Error('BACKUP_NOT_FOUND'); await this.audit('recovery_candidate_inspected', this.actor(actor), backupId); return item }
  async pendingRequest() { const root = join(this.adminRoot, 'requests'); if (!existsSync(root)) return null; const requests = (await readdir(root)).filter(name => name.endsWith('.json')).sort(); for (const name of requests) { const value = await this.json<any>(join(root, name)); if (value?.state === 'pending') return { path: join(root, name), value } } return null }
  async completeRequest(path: string, backupId: string) { const request = await this.json<any>(path); if (!request || request.state !== 'pending') throw new Error('BACKUP_REQUEST_NOT_PENDING'); await writeJsonAtomic(path, { ...request, state: 'completed', completedAt: new Date().toISOString(), backupId }); await this.audit('backup_verified', systemActor, backupId, { requestId: request.id }) }
  async recordBackup(category: BackupCategory, backupId: string, success: boolean, error?: unknown) { await this.audit(success ? 'backup_verified' : 'backup_failed', systemActor, backupId, { category, ...(error ? { error: safeError(error) } : {}) }) }
  async schedulerOutcomes() {
    const path = join(this.adminRoot, 'scheduler', 'logs', 'windows-task-events.jsonl')
    if (!existsSync(path)) return [] as Array<{ task: string; finishedAt: string; result: 'SUCCEEDED' | 'FAILED'; exitCode: number; classification: string; restartResult: string }>
    const latest = new Map<string, { task: string; finishedAt: string; result: 'SUCCEEDED' | 'FAILED'; exitCode: number; classification: string; restartResult: string }>()
    for (const line of (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean)) {
      try {
        const event = JSON.parse(line) as { version?: string; event?: string; task?: string; finishedAt?: string; result?: string; exitCode?: number; classification?: string; restartResult?: string }
        if (event.version !== 'andalucia-windows-scheduler-event-v1' || event.event !== 'windows_task_finished' || !event.task || !event.finishedAt || !['SUCCEEDED', 'FAILED'].includes(event.result || '')) continue
        const current = latest.get(event.task)
        if (!current || event.finishedAt > current.finishedAt) latest.set(event.task, { task: event.task, finishedAt: event.finishedAt, result: event.result as 'SUCCEEDED' | 'FAILED', exitCode: Number(event.exitCode || 0), classification: String(event.classification || '').slice(0, 500), restartResult: String(event.restartResult || 'NOT_REQUIRED') })
      } catch { /* A malformed scheduler line is ignored and is never trusted as success. */ }
    }
    return [...latest.values()].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
  }
  async rehearse(backupId: string, actor?: AuditActor): Promise<RestoreResult> {
    if (existsSync(operationMarkerPaths(this.canonicalDirectory).recovery)) throw new Error('RECOVERY_IN_PROGRESS_OPERATION_BLOCKED')
    const folder = this.folder(backupId); const metadata = await this.json<BackupMetadata>(join(folder, 'backup-metadata.json')); if (!metadata || metadata.verificationStatus !== 'VERIFIED') throw new Error('VERIFIED_BACKUP_REQUIRED')
    const startedAt = new Date().toISOString(); const rehearsalRoot = join(this.adminRoot, 'rehearsals', `${backupId}-${randomUUID()}`); const descendant = join(rehearsalRoot, 'postgres'); await this.audit('restore_rehearsal_started', this.actor(actor), backupId)
    const originalBefore = await createStoreManifest(metadata.backupDirectory)
    try {
      if (!manifestsMatch(originalBefore, metadata.backupManifest)) throw new Error('RESTORE_TEST_MANIFEST_MISMATCH')
      const verified = await verifyBackupCopy({ backupDirectory: metadata.backupDirectory, sourceManifest: metadata.backupManifest, verificationDirectory: descendant, copyRole: 'rehearsal' })
      const fingerprintMatch = same(metadata.operationalFingerprint, verified.fingerprint) && (!metadata.financialFinalizationFingerprint || same(metadata.financialFinalizationFingerprint, verified.financialFinalizationFingerprint)); const migrationMatch = same((metadata as any).migrationLedger, verified.migration)
      if (!fingerprintMatch) throw new Error('RESTORE_TEST_FINGERPRINT_MISMATCH')
      if (!migrationMatch) throw new Error('RESTORE_TEST_MIGRATION_MISMATCH')
      const originalAfter = await createStoreManifest(metadata.backupDirectory); if (!manifestsMatch(originalBefore, originalAfter)) throw new Error('RESTORE_TEST_CHANGED_ORIGINAL_BACKUP')
      const result: RestoreResult = { status: 'RESTORE_TEST_PASSED', startedAt, completedAt: new Date().toISOString(), backupId, manifestMatch: true, fingerprintMatch, migrationMatch, preflightStatus: verified.preflight.status }
      await writeJsonAtomic(join(folder, 'restore-test.json'), result)
      await writeJsonAtomic(join(folder, 'backup-candidate.json'), { backupId, category: metadata.category, state: 'VERIFIED_REHEARSED', verifiedAt: result.completedAt, sourceDirectory: metadata.sourceDirectory })
      await this.audit('restore_rehearsal_completed', this.actor(actor), backupId); return result
    } catch (error) {
      const result: RestoreResult = { status: 'RESTORE_TEST_FAILED', startedAt, completedAt: new Date().toISOString(), backupId, manifestMatch: false, fingerprintMatch: false, migrationMatch: false, preflightStatus: 'FAILED', error: safeError(error) }
      await writeJsonAtomic(join(folder, 'restore-test.json'), result); await this.audit('restore_rehearsal_failed', this.actor(actor), backupId, { error: result.error }); throw error
    } finally { if (resolve(rehearsalRoot).startsWith(resolve(this.adminRoot, 'rehearsals'))) await rm(rehearsalRoot, { recursive: true, force: true }) }
  }
  async retentionPlan() {
    const policy = await this.policy(); const items = await this.inventory(); const remove: BackupInventoryItem[] = []
    for (const [category, limit] of [['automatic-daily', policy.retention.daily], ['automatic-weekly', policy.retention.weekly]] as const) {
      const categoryItems = items.filter(item => item.category === category && item.verificationStatus === 'VERIFIED')
      for (const item of categoryItems.slice(limit)) if (!item.protected && categoryItems.filter(candidate => candidate.createdAt > item.createdAt && candidate.verificationStatus === 'VERIFIED').length > 0) remove.push(item)
    }
    return { generatedAt: new Date().toISOString(), keep: items.filter(item => !remove.some(old => old.backupId === item.backupId)), remove, policy }
  }
  async applyRetention(confirmation: string) { if (confirmation !== 'YES_I_APPROVE_DB2_RETENTION') throw new Error('RETENTION_EXPLICIT_AUTHORIZATION_REQUIRED'); const plan = await this.retentionPlan(); for (const item of plan.remove) { const folder = resolve(this.folder(item.backupId)); if (dirname(folder) !== this.backupRoot || item.protected) throw new Error('RETENTION_PATH_OR_PROTECTION_REJECTED'); await rm(folder, { recursive: true }); await this.audit('retention_cleanup', systemActor, item.backupId) } return plan }
  rankRecoveryCandidates(items: BackupInventoryItem[]) { return items.filter(item => item.verificationStatus === 'VERIFIED' && item.restoreTestStatus !== 'RESTORE_TEST_FAILED').map(item => ({ ...item, recoveryScore: (item.restoreTestStatus === 'RESTORE_TEST_PASSED' ? 50 : 0) + (item.schemaVersion === SUPPORTED_SCHEMA_VERSION ? 20 : 0) + (item.operationalFingerprint ? 10 : 0) + (item.protected ? 5 : 0) + Math.max(0, 15 - Math.floor((Date.now() - Date.parse(item.createdAt)) / 86400000)) })).sort((a, b) => b.recoveryScore - a.recoveryScore || b.createdAt.localeCompare(a.createdAt)) }
  async summary(database: DatabaseHealth) {
    const policy = await this.ensurePolicy(); const inventory = await this.inventory(); const storage = await this.storage(); const pending = await this.pendingRequest(); const schedulerOutcomes = await this.schedulerOutcomes(); const verified = inventory.filter(item => item.verificationStatus === 'VERIFIED'); const last = verified[0] || null; const restorePassed = inventory.filter(item => item.restoreTestStatus === 'RESTORE_TEST_PASSED').sort((a, b) => (b.latestRestoreTestAt || '').localeCompare(a.latestRestoreTestAt || ''))[0] || null
    const warnings: string[] = []; const backupRecent = Boolean(last && Date.now() - Date.parse(last.createdAt) <= policy.backupAgeWarningHours * 3600000); const restoreRecent = Boolean(restorePassed?.latestRestoreTestAt && Date.now() - Date.parse(restorePassed.latestRestoreTestAt) <= policy.restoreRehearsalIntervalDays * 86400000)
    if (!backupRecent) warnings.push('No recent verified backup.')
    if (inventory.some(item => item.verificationStatus === 'INVALID')) warnings.push('One or more backup attempts are invalid.')
    if (!restorePassed) warnings.push('Restore rehearsal is pending.')
    else if (!restoreRecent) warnings.push('Restore rehearsal is overdue.')
    if (inventory.some(item => item.restoreTestStatus === 'RESTORE_TEST_FAILED')) warnings.push('A restore rehearsal failed; that backup is not a preferred recovery candidate.')
    if (database.migrationRequired) warnings.push('Database migration is required.')
    if (database.recoveryRequired) warnings.push('Database recovery review is required.')
    for (const outcome of schedulerOutcomes.filter(item => item.result === 'FAILED')) warnings.push(`${outcome.task === 'DailyBackup' ? 'Scheduled backup' : 'Scheduled restore rehearsal'} requires attention.`)
    if (!['HEALTHY', 'BACKUP_RECOMMENDED'].includes(database.status)) warnings.push(`Canonical database state requires attention: ${database.status.replaceAll('_', ' ')}.`)
    const recoveryReady = ['HEALTHY', 'BACKUP_RECOMMENDED'].includes(database.status) && !database.recoveryRequired && backupRecent && restoreRecent
    return { database, policy, inventory, storage, schedulerOutcomes, pendingBackupRequest: pending?.value || null, lastVerifiedBackup: last, lastRestoreTest: restorePassed, recoveryReadiness: recoveryReady ? 'READY' : 'ATTENTION_REQUIRED', warnings, recoveryCandidates: this.rankRecoveryCandidates(inventory).slice(0, 5) }
  }
}
