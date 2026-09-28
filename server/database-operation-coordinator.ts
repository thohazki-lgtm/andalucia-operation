import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, stat, statfs, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { StoreManifest } from './migration-filesystem.js'

export const DATABASE_OPERATION_JOURNAL_VERSION = 'andalucia-database-operation-v1'
export const DATABASE_OPERATION_LEASE_VERSION = 'andalucia-database-operation-lease-v1'
export const DATABASE_OPERATION_PERIOD_VERSION = 'andalucia-database-operation-period-v1'
export const DATABASE_OPERATION_TIMEZONE = 'Indian/Maldives'

export type DatabaseOperationType =
  | 'scheduled_backup' | 'manual_backup' | 'verification' | 'restore_rehearsal'
  | 'protection_change' | 'encrypted_export' | 'upload' | 'remote_verification'
  | 'local_retention' | 'cloud_retention' | 'migration' | 'recovery' | 'canonical_maintenance'
export type DatabaseOperationState = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED'
export type DatabaseOperationFailureClass = 'RETRYABLE' | 'NON_RETRYABLE' | 'REQUIRES_REVIEW' | null
export type DatabaseOperationResource = { kind: 'canonical' | 'backup' | 'artifact' | 'period'; id: string }

export type DatabaseOperationJournal = {
  version: typeof DATABASE_OPERATION_JOURNAL_VERSION
  operationId: string
  operationType: DatabaseOperationType
  resource: DatabaseOperationResource
  backupId?: string
  periodKey?: string
  startedAt: string
  updatedAt: string
  terminalAt?: string
  owner: { pid: number; host: string }
  state: DatabaseOperationState
  failureClassification: DatabaseOperationFailureClass
  retryable: boolean
  cleanupState: 'NOT_REQUIRED' | 'PENDING' | 'COMPLETE' | 'REQUIRES_REVIEW'
  details?: Record<string, unknown>
}
export type DatabaseOperationLeaseRecord = {
  version: typeof DATABASE_OPERATION_LEASE_VERSION
  operationId: string
  operationType: DatabaseOperationType
  resource: DatabaseOperationResource
  pid: number
  host: string
  createdAt: string
  updatedAt: string
}

export type DatabaseOperationPeriodRecord = {
  version: typeof DATABASE_OPERATION_PERIOD_VERSION
  category: 'daily' | 'weekly'
  intendedPeriod: string
  timezone: typeof DATABASE_OPERATION_TIMEZONE
  periodKey: string
  operationId: string
  state: DatabaseOperationState
  attempt: number
  backupId?: string
  failureClassification: DatabaseOperationFailureClass
  retryable: boolean
  updatedAt: string
  terminalAt?: string
}

const safeName = (value: string) => createHash('sha256').update(value).digest('hex')
const hostName = () => process.env.COMPUTERNAME || process.env.HOSTNAME || 'unknown'
const json = async <T>(path: string) => JSON.parse(await readFile(path, 'utf8')) as T
const durableJson = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx')
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); await handle.sync() } finally { await handle.close() }
  await rename(temporary, path)
}
const isProcessAlive = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

const maldivesParts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: DATABASE_OPERATION_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
}).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value])) as Record<'year' | 'month' | 'day', string>

const isoWeek = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day)); const weekday = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday)
  const weekYear = date.getUTCFullYear(); const yearStart = new Date(Date.UTC(weekYear, 0, 1))
  return { year: weekYear, week: Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7) }
}

export const databaseOperationPeriodKey = (category: 'daily' | 'weekly', date = new Date()) => {
  const parts = maldivesParts(date); const calendar = `${parts.year}-${parts.month}-${parts.day}`
  if (category === 'daily') return `daily:${calendar}:${DATABASE_OPERATION_TIMEZONE}`
  const week = isoWeek(Number(parts.year), Number(parts.month), Number(parts.day))
  return `weekly:${week.year}-W${String(week.week).padStart(2, '0')}:${DATABASE_OPERATION_TIMEZONE}`
}

export const classifyDatabaseOperationFailure = (error: unknown): Exclude<DatabaseOperationFailureClass, null> => {
  const message = error instanceof Error ? error.message : String(error)
  if (/MANIFEST|SOURCE_.*CHANGED|IDENTITY|INTEGRITY|PREFLIGHT|JOURNAL|AMBIGUOUS|PROTECTION|OWNERSHIP|CORRUPT/i.test(message)) return 'REQUIRES_REVIEW'
  if (/SPACE|ENOSPC|BUSY|CONTENTION|TEMPORAR|NETWORK|TIMEOUT/i.test(message)) return 'RETRYABLE'
  return 'NON_RETRYABLE'
}

export type StorageHeadroomAssessment = {
  operationType: 'backup' | 'encrypted_export' | 'remote_verification'
  availableBytes: number
  sourceBytes: number
  requiredBytes: number
  safetyMarginBytes: number
  sufficient: boolean
  basis: string
}

export const assessStorageHeadroom = (input: { operationType: StorageHeadroomAssessment['operationType']; availableBytes: number; sourceBytes: number }) => {
  const safetyMarginBytes = Math.max(256 * 1024 * 1024, Math.ceil(input.sourceBytes * 0.1))
  const multiplier = input.operationType === 'backup' ? 2 : input.operationType === 'encrypted_export' ? 1.25 : 1.1
  const requiredBytes = Math.ceil(input.sourceBytes * multiplier) + safetyMarginBytes
  const basis = input.operationType === 'backup'
    ? 'One complete backup plus one disposable verification/rehearsal descendant and a 10%/256MiB margin.'
    : input.operationType === 'encrypted_export'
      ? 'Encrypted partial/final output allowance plus a 10%/256MiB margin; plaintext archive persistence is forbidden.'
      : 'One fresh encrypted verification download plus a 10%/256MiB margin.'
  return { ...input, requiredBytes, safetyMarginBytes, sufficient: input.availableBytes >= requiredBytes, basis } satisfies StorageHeadroomAssessment
}

export const assessPathStorageHeadroom = async (path: string, operationType: StorageHeadroomAssessment['operationType'], sourceBytes: number) => {
  const filesystem = await statfs(resolve(path)); return assessStorageHeadroom({ operationType, sourceBytes, availableBytes: filesystem.bavail * filesystem.bsize })
}

export const directorySizeBytes = async (rootInput: string) => {
  const root = resolve(rootInput); let bytes = 0
  const visit = async (folder: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) bytes += (await stat(path)).size
      else throw new Error(`DATABASE_OPERATION_UNSUPPORTED_SOURCE_ENTRY:${path}`)
    }
  }
  await visit(root); return bytes
}

export type BackupSourceEvidence = {
  backupId: string; role: string; state: string; schema: string; manifestSha256: string; fileCount: number; byteCount: number; pinned: boolean; protectedReadOnly: boolean
}
export const backupSourceEvidenceMatches = (before: BackupSourceEvidence, after: BackupSourceEvidence) => JSON.stringify(before) === JSON.stringify(after)
export const assertBackupSourceEvidenceUnchanged = (before: BackupSourceEvidence, after: BackupSourceEvidence) => {
  if (!backupSourceEvidenceMatches(before, after)) throw new Error('PROTECTED_BACKUP_SOURCE_CHANGED')
}

export const deriveEffectiveBackupState = (input: { candidateState?: string | null; verificationStatus?: string | null; openTestStatus?: string | null; preflightStatus?: string | null; restoreStatus?: string | null; pinned?: boolean }) => {
  const verified = input.verificationStatus === 'VERIFIED' && input.openTestStatus === 'PASS' && input.preflightStatus === 'READY'
  const effectiveState = verified && input.restoreStatus === 'RESTORE_TEST_PASSED' ? 'VERIFIED_REHEARSED' : verified ? 'VERIFIED' : 'INVALID'
  const discrepancy = Boolean(input.candidateState && input.candidateState !== effectiveState)
  return { effectiveState, discrepancy, warning: discrepancy ? `EVIDENCE_STATE_DISCREPANCY:${input.candidateState}->${effectiveState}` : null, reconciliationVersion: 'andalucia-backup-state-reconciliation-v1' }
}

export const retentionDependencyBlockers = (input: { protected: boolean; latestRecoverable: boolean; unresolvedRecovery: boolean; activeOperations: DatabaseOperationType[]; cloudVerificationRequired: boolean }) => [
  ...(input.protected ? ['PROTECTED_BACKUP'] : []),
  ...(input.latestRecoverable ? ['LATEST_REQUIRED_RECOVERABLE_GENERATION'] : []),
  ...(input.unresolvedRecovery ? ['UNRESOLVED_RECOVERY_EVENT'] : []),
  ...(input.cloudVerificationRequired ? ['CLOUD_VERIFICATION_DEPENDENCY'] : []),
  ...input.activeOperations.map(operation => `ACTIVE_${operation.toUpperCase()}`)
]

export class DatabaseOperationCoordinator {
  readonly root: string; readonly leasesRoot: string; readonly journalRoot: string; readonly periodsRoot: string; readonly temporaryRoot: string
  constructor(root: string, readonly options: { host?: string; pid?: number; now?: () => Date; processAlive?: (pid: number) => boolean } = {}) {
    this.root = resolve(root); this.leasesRoot = join(this.root, 'leases'); this.journalRoot = join(this.root, 'journal'); this.periodsRoot = join(this.root, 'periods'); this.temporaryRoot = join(this.root, 'temporary')
  }
  private now() { return (this.options.now || (() => new Date()))().toISOString() }
  private owner() { return { pid: this.options.pid || process.pid, host: this.options.host || hostName() } }
  leasePath(resource: DatabaseOperationResource) { return join(this.leasesRoot, `${resource.kind}-${safeName(resource.id)}.json`) }
  journalPath(operationId: string) { return join(this.journalRoot, `${operationId}.json`) }
  periodPath(periodKey: string) { return join(this.periodsRoot, `${safeName(periodKey)}.json`) }
  temporaryPath(operationId: string, name: string) {
    if (basename(name) !== name || name.includes('..')) throw new Error('TEMPORARY_ARTIFACT_NAME_INVALID')
    return join(this.temporaryRoot, operationId, name)
  }
  async acquire(input: { operationType: DatabaseOperationType; resource: DatabaseOperationResource; backupId?: string; periodKey?: string }) {
    const operationId = randomUUID(); const startedAt = this.now(); const owner = this.owner(); const leasePath = this.leasePath(input.resource)
    await mkdir(this.leasesRoot, { recursive: true }); await mkdir(this.journalRoot, { recursive: true })
    const pending: DatabaseOperationJournal = { version: DATABASE_OPERATION_JOURNAL_VERSION, operationId, operationType: input.operationType, resource: input.resource, backupId: input.backupId, periodKey: input.periodKey, startedAt, updatedAt: startedAt, owner, state: 'PENDING', failureClassification: null, retryable: false, cleanupState: 'NOT_REQUIRED' }
    await durableJson(this.journalPath(operationId), pending)
    if (input.periodKey) {
      try { await this.claimPeriod(input.periodKey, input.operationType === 'scheduled_backup' ? (input.periodKey.startsWith('weekly:') ? 'weekly' : 'daily') : 'daily', operationId) }
      catch (error) { const classification = classifyDatabaseOperationFailure(error); const failedAt = this.now(); await durableJson(this.journalPath(operationId), { ...pending, state: 'FAILED', updatedAt: failedAt, terminalAt: failedAt, failureClassification: classification, retryable: classification === 'RETRYABLE', cleanupState: 'COMPLETE', details: { error: error instanceof Error ? error.message : String(error) } } satisfies DatabaseOperationJournal); throw error }
    }
    const lease: DatabaseOperationLeaseRecord = { version: DATABASE_OPERATION_LEASE_VERSION, operationId, operationType: input.operationType, resource: input.resource, ...owner, createdAt: startedAt, updatedAt: startedAt }
    let handle
    try { handle = await open(leasePath, 'wx') } catch (error) {
      if (input.periodKey) await this.failPeriod(input.periodKey, operationId, 'RETRYABLE').catch(() => undefined)
      await durableJson(this.journalPath(operationId), { ...pending, state: 'FAILED', updatedAt: this.now(), terminalAt: this.now(), failureClassification: 'RETRYABLE', retryable: true, cleanupState: 'COMPLETE', details: { error: 'DATABASE_OPERATION_LEASE_CONFLICT' } } satisfies DatabaseOperationJournal)
      throw new Error(`DATABASE_OPERATION_LEASE_CONFLICT:${input.resource.kind}:${input.resource.id}`, { cause: error })
    }
    try { await handle.writeFile(`${JSON.stringify(lease, null, 2)}\n`, 'utf8'); await handle.sync() } finally { await handle.close() }
    const journal: DatabaseOperationJournal = { ...pending, state: 'RUNNING', updatedAt: this.now() }
    await durableJson(this.journalPath(operationId), journal)
    let finished = false
    const finish = async (state: Extract<DatabaseOperationState, 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED'>, details: Record<string, unknown> = {}, failureClassification: DatabaseOperationFailureClass = null) => {
      if (finished) return
      const currentLease = await json<DatabaseOperationLeaseRecord>(leasePath).catch(() => null)
      if (!currentLease || currentLease.operationId !== operationId || currentLease.pid !== owner.pid || currentLease.host !== owner.host) throw new Error('DATABASE_OPERATION_LEASE_OWNERSHIP_MISMATCH')
      const current = await json<DatabaseOperationJournal>(this.journalPath(operationId)); const terminalAt = this.now()
      await durableJson(this.journalPath(operationId), { ...current, state, updatedAt: terminalAt, terminalAt, failureClassification, retryable: failureClassification === 'RETRYABLE', cleanupState: details.cleanupState === 'PENDING' ? 'PENDING' : 'COMPLETE', details: { ...(current.details || {}), ...details } } satisfies DatabaseOperationJournal)
      if (input.periodKey) {
        if (state === 'SUCCEEDED') await this.completePeriod(input.periodKey, operationId, typeof details.backupId === 'string' ? details.backupId : undefined)
        else await this.failPeriod(input.periodKey, operationId, failureClassification || 'NON_RETRYABLE')
      }
      await unlink(leasePath); finished = true
    }
    return { operationId, leasePath, journalPath: this.journalPath(operationId), succeed: (details?: Record<string, unknown>) => finish('SUCCEEDED', details), fail: (error: unknown, details: Record<string, unknown> = {}) => { const classification = classifyDatabaseOperationFailure(error); return finish('FAILED', { ...details, error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }, classification) }, cancel: (details?: Record<string, unknown>) => finish('CANCELLED', details), interrupt: (details?: Record<string, unknown>) => finish('INTERRUPTED', details, 'REQUIRES_REVIEW') }
  }
  private async claimPeriod(periodKey: string, category: 'daily' | 'weekly', operationId: string) {
    await mkdir(this.periodsRoot, { recursive: true }); const path = this.periodPath(periodKey); const existing = existsSync(path) ? await json<DatabaseOperationPeriodRecord>(path).catch(() => null) : null
    if (existsSync(path) && !existing) throw new Error('DATABASE_OPERATION_PERIOD_JOURNAL_CORRUPT')
    if (existing?.state === 'SUCCEEDED') throw new Error(`DATABASE_OPERATION_PERIOD_ALREADY_SUCCEEDED:${periodKey}`)
    if (existing?.state === 'RUNNING') throw new Error(`DATABASE_OPERATION_PERIOD_AMBIGUOUS:${periodKey}`)
    if (existing && (!existing.retryable || existing.failureClassification !== 'RETRYABLE')) throw new Error(`DATABASE_OPERATION_PERIOD_REQUIRES_REVIEW:${periodKey}`)
    const intendedPeriod = periodKey.split(':')[1] || periodKey
    await durableJson(path, { version: DATABASE_OPERATION_PERIOD_VERSION, category, intendedPeriod, timezone: DATABASE_OPERATION_TIMEZONE, periodKey, operationId, state: 'RUNNING', attempt: (existing?.attempt || 0) + 1, failureClassification: null, retryable: false, updatedAt: this.now() } satisfies DatabaseOperationPeriodRecord)
  }
  private async completePeriod(periodKey: string, operationId: string, backupId?: string) { const path = this.periodPath(periodKey); const record = await json<DatabaseOperationPeriodRecord>(path); if (record.operationId !== operationId || record.state !== 'RUNNING') throw new Error('DATABASE_OPERATION_PERIOD_OWNERSHIP_MISMATCH'); const now = this.now(); await durableJson(path, { ...record, state: 'SUCCEEDED', backupId, updatedAt: now, terminalAt: now }) }
  private async failPeriod(periodKey: string, operationId: string, failureClassification: Exclude<DatabaseOperationFailureClass, null>) { const path = this.periodPath(periodKey); const record = await json<DatabaseOperationPeriodRecord>(path); if (record.operationId !== operationId) throw new Error('DATABASE_OPERATION_PERIOD_OWNERSHIP_MISMATCH'); const now = this.now(); await durableJson(path, { ...record, state: 'FAILED', failureClassification, retryable: failureClassification === 'RETRYABLE', updatedAt: now, terminalAt: now }) }
  async activeLeases() {
    if (!existsSync(this.leasesRoot)) return [] as DatabaseOperationLeaseRecord[]
    const result: DatabaseOperationLeaseRecord[] = []
    for (const name of await readdir(this.leasesRoot)) if (name.endsWith('.json')) result.push(await json<DatabaseOperationLeaseRecord>(join(this.leasesRoot, name)))
    return result
  }
  async reconcile() {
    const journals: Array<{ journal: DatabaseOperationJournal; classification: 'COMPLETED' | 'ACTIVE' | 'INTERRUPTED' | 'REQUIRES_REVIEW'; reason: string }> = []
    if (!existsSync(this.journalRoot)) return journals
    for (const name of await readdir(this.journalRoot)) {
      if (!name.endsWith('.json')) continue
      let journal: DatabaseOperationJournal
      try { journal = await json<DatabaseOperationJournal>(join(this.journalRoot, name)) } catch { throw new Error(`DATABASE_OPERATION_JOURNAL_CORRUPT:${name}`) }
      if (journal.version !== DATABASE_OPERATION_JOURNAL_VERSION || basename(`${journal.operationId}.json`) !== name) throw new Error(`DATABASE_OPERATION_JOURNAL_CORRUPT:${name}`)
      if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(journal.state)) { journals.push({ journal, classification: 'COMPLETED', reason: journal.state }); continue }
      const lease = await json<DatabaseOperationLeaseRecord>(this.leasePath(journal.resource)).catch(() => null)
      if (!lease || lease.operationId !== journal.operationId) { journals.push({ journal, classification: 'REQUIRES_REVIEW', reason: 'LEASE_MISSING_OR_MISMATCHED' }); continue }
      if (lease.host !== this.owner().host) { journals.push({ journal, classification: 'REQUIRES_REVIEW', reason: 'REMOTE_OR_UNKNOWN_HOST_OWNER' }); continue }
      const alive = (this.options.processAlive || isProcessAlive)(lease.pid)
      journals.push(alive ? { journal, classification: 'ACTIVE', reason: 'OWNER_PROCESS_ALIVE' } : { journal, classification: 'INTERRUPTED', reason: 'OWNER_PROCESS_NOT_ALIVE_MANUAL_RECONCILIATION_REQUIRED' })
    }
    return journals
  }
}

