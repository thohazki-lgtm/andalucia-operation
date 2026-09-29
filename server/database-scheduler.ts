import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { FileHandle } from 'node:fs/promises'
import { operationMarkerPaths } from './database-protection.js'
import { DatabaseOperationCoordinator, type DatabaseOperationType } from './database-operation-coordinator.js'

export type DatabaseSchedulerJob = 'daily-backup' | 'weekly-restore-rehearsal' | 'retention' | 'requested-backup' | 'manual-backup'
export type DatabaseSchedulerResult = 'SUCCEEDED' | 'FAILED'

export const schedulerRoot = (backupRoot: string) => join(resolve(backupRoot), '.db2', 'scheduler')
export const schedulerLockPath = (backupRoot: string) => join(schedulerRoot(backupRoot), 'job.lock')

const safeError = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500)
const appendSchedulerLog = async (backupRoot: string, entry: Record<string, unknown>) => {
  const root = schedulerRoot(backupRoot)
  await mkdir(join(root, 'logs'), { recursive: true })
  await appendFile(join(root, 'logs', 'scheduler-events.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8')
}

export const databaseOperationCoordinatorRoot = (backupRoot: string) => join(resolve(backupRoot), '.db2', 'operations')

const operationTypeForJob = (job: DatabaseSchedulerJob): DatabaseOperationType => job === 'daily-backup'
  ? 'scheduled_backup'
  : job === 'requested-backup' || job === 'manual-backup'
    ? 'manual_backup'
    : job === 'weekly-restore-rehearsal'
      ? 'restore_rehearsal'
      : 'local_retention'

export const acquireDatabaseSchedulerLock = async (options: { backupRoot: string; canonicalDirectory: string; job: DatabaseSchedulerJob; periodKey?: string }) => {
  const backupRoot = resolve(options.backupRoot)
  const canonicalDirectory = resolve(options.canonicalDirectory)
  const markers = operationMarkerPaths(canonicalDirectory)
  if (existsSync(markers.migration)) throw new Error('DATABASE_SCHEDULER_MIGRATION_IN_PROGRESS')
  if (existsSync(markers.recovery)) throw new Error('DATABASE_SCHEDULER_RECOVERY_IN_PROGRESS')
  const coordinator = new DatabaseOperationCoordinator(databaseOperationCoordinatorRoot(backupRoot))
  const operation = await coordinator.acquire({ operationType: operationTypeForJob(options.job), resource: { kind: 'canonical', id: canonicalDirectory }, periodKey: options.periodKey }).catch(error => {
    if (error instanceof Error && error.message.startsWith('DATABASE_OPERATION_LEASE_CONFLICT:canonical:')) throw new Error('DATABASE_SCHEDULER_JOB_ALREADY_RUNNING', { cause: error })
    throw error
  })
  const root = schedulerRoot(backupRoot)
  await mkdir(root, { recursive: true })
  const path = schedulerLockPath(backupRoot)
  let handle: FileHandle
  try { handle = await open(path, 'wx') } catch { const conflict = new Error('TEMPORARY_PROCESS_CONTENTION:DATABASE_SCHEDULER_JOB_ALREADY_RUNNING'); await operation.fail(conflict); throw new Error('DATABASE_SCHEDULER_JOB_ALREADY_RUNNING') }
  const id = randomUUID()
  const startedAt = new Date().toISOString()
  await handle.writeFile(JSON.stringify({ version: 'andalucia-database-scheduler-lock-v1', id, job: options.job, startedAt, pid: process.pid, host: process.env.COMPUTERNAME || 'unknown' }), 'utf8')
  await handle.sync()
  await appendSchedulerLog(backupRoot, { id: randomUUID(), event: 'scheduler_job_started', jobId: id, job: options.job, startedAt, source: 'windows_task_scheduler' })
  let released = false
  return {
    id,
    path,
    async release(result: DatabaseSchedulerResult, details: Record<string, unknown> = {}) {
      if (released) return
      released = true
      const finishedAt = new Date().toISOString()
      await appendSchedulerLog(backupRoot, { id: randomUUID(), event: 'scheduler_job_finished', jobId: id, job: options.job, startedAt, finishedAt, result, ...details })
      await handle.close()
      await unlink(path).catch(() => undefined)
      if (result === 'SUCCEEDED') await operation.succeed(details)
      else await operation.fail(String(details.error || 'DATABASE_SCHEDULER_JOB_FAILED'), details)
    }
  }
}

export type SchedulerShutdownRequest = {
  version: 'andalucia-scheduler-shutdown-v1'
  requestId: string
  requestedAt: string
  action: 'graceful_shutdown'
  source: 'windows_task_scheduler'
}

export const startSchedulerShutdownControl = (options: {
  backupRoot: string
  gracefulShutdown: (reason: string) => Promise<void>
  exit?: (code: number) => void
}) => {
  const root = join(schedulerRoot(options.backupRoot), 'control')
  const requests = join(root, 'requests')
  const processing = join(root, 'processing')
  const responses = join(root, 'responses')
  let handling = false
  const inspect = async () => {
    if (handling || !existsSync(requests)) return
    const { readdir } = await import('node:fs/promises')
    const names = (await readdir(requests)).filter(name => name.endsWith('.json')).sort()
    if (!names.length) return
    handling = true
    const name = names[0]
    if (basename(name) !== name) return
    await mkdir(processing, { recursive: true })
    await mkdir(responses, { recursive: true })
    const source = join(requests, name)
    const claimed = join(processing, name)
    try {
      await rename(source, claimed)
      const request = JSON.parse(await readFile(claimed, 'utf8')) as SchedulerShutdownRequest
      const response = join(responses, `${request.requestId}.json`)
      if (request.version !== 'andalucia-scheduler-shutdown-v1' || request.action !== 'graceful_shutdown' || request.source !== 'windows_task_scheduler' || basename(`${request.requestId}.json`) !== `${request.requestId}.json` || Date.now() - Date.parse(request.requestedAt) > 2 * 60_000) throw new Error('SCHEDULER_SHUTDOWN_REQUEST_INVALID_OR_STALE')
      await writeFile(response, JSON.stringify({ requestId: request.requestId, state: 'accepted', acceptedAt: new Date().toISOString() }), 'utf8')
      await options.gracefulShutdown('WINDOWS_SCHEDULER')
      await writeFile(response, JSON.stringify({ requestId: request.requestId, state: 'completed', completedAt: new Date().toISOString() }), 'utf8')
      await unlink(claimed).catch(() => undefined)
      ;(options.exit || ((code: number) => process.exit(code)))(0)
    } catch (error) {
      const requestId = name.replace(/\.json$/i, '')
      await writeFile(join(responses, `${requestId}.json`), JSON.stringify({ requestId, state: 'failed', failedAt: new Date().toISOString(), error: safeError(error) }), 'utf8').catch(() => undefined)
      handling = false
    }
  }
  void Promise.all([mkdir(requests, { recursive: true }), mkdir(processing, { recursive: true }), mkdir(responses, { recursive: true })])
  const timer = setInterval(() => void inspect().catch(() => { handling = false }), 500)
  timer.unref()
  return () => clearInterval(timer)
}

export const schedulerJobBlocksMigration = (backupRoot: string) => existsSync(schedulerLockPath(backupRoot)) || existsSync(new DatabaseOperationCoordinator(databaseOperationCoordinatorRoot(backupRoot)).leasePath({ kind: 'canonical', id: resolve(backupRoot, '..', '.data', 'postgres') }))
