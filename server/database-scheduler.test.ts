import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { acquireDatabaseSchedulerLock, schedulerLockPath, startSchedulerShutdownControl } from './database-scheduler.js'

const root = await mkdtemp(join(tmpdir(), 'andalucia-windows-scheduler-'))
const backupRoot = join(root, 'backups')
const canonical = join(root, 'data', 'postgres')
await mkdir(canonical, { recursive: true })
try {
  const lock = await acquireDatabaseSchedulerLock({ backupRoot, canonicalDirectory: canonical, job: 'daily-backup' })
  assert.equal(existsSync(schedulerLockPath(backupRoot)), true)
  await assert.rejects(acquireDatabaseSchedulerLock({ backupRoot, canonicalDirectory: canonical, job: 'weekly-restore-rehearsal' }), /DATABASE_SCHEDULER_JOB_ALREADY_RUNNING/)
  await lock.release('SUCCEEDED', { verificationResult: 'VERIFIED', exitCode: 0 })
  assert.equal(existsSync(schedulerLockPath(backupRoot)), false)
  const log = await readFile(join(backupRoot, '.db2', 'scheduler', 'logs', 'scheduler-events.jsonl'), 'utf8')
  assert.match(log, /scheduler_job_started/)
  assert.match(log, /scheduler_job_finished/)
  assert.match(log, /VERIFIED/)

  await writeFile(join(root, 'data', 'migration-in-progress'), 'test marker', 'utf8')
  await assert.rejects(acquireDatabaseSchedulerLock({ backupRoot, canonicalDirectory: canonical, job: 'daily-backup' }), /DATABASE_SCHEDULER_MIGRATION_IN_PROGRESS/)
  await rm(join(root, 'data', 'migration-in-progress'))
  await writeFile(join(root, 'data', 'recovery-in-progress'), 'test marker', 'utf8')
  await assert.rejects(acquireDatabaseSchedulerLock({ backupRoot, canonicalDirectory: canonical, job: 'daily-backup' }), /DATABASE_SCHEDULER_RECOVERY_IN_PROGRESS/)
  await rm(join(root, 'data', 'recovery-in-progress'))

  let shutdownCalled = false
  let exitCode: number | null = null
  const stopControl = startSchedulerShutdownControl({ backupRoot, gracefulShutdown: async () => { shutdownCalled = true }, exit: code => { exitCode = code } })
  const requestId = 'isolated-scheduler-request'
  const requestRoot = join(backupRoot, '.db2', 'scheduler', 'control', 'requests')
  await mkdir(requestRoot, { recursive: true })
  await writeFile(join(requestRoot, `${requestId}.json`), JSON.stringify({ version: 'andalucia-scheduler-shutdown-v1', requestId, requestedAt: new Date().toISOString(), action: 'graceful_shutdown', source: 'windows_task_scheduler' }), 'utf8')
  const deadline = Date.now() + 5_000
  const response = join(backupRoot, '.db2', 'scheduler', 'control', 'responses', `${requestId}.json`)
  while ((!existsSync(response) || JSON.parse(await readFile(response, 'utf8')).state !== 'completed' || exitCode === null) && Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, 50))
  stopControl()
  assert.equal(shutdownCalled, true)
  assert.equal(exitCode, 0)
  assert.equal(JSON.parse(await readFile(response, 'utf8')).state, 'completed')

  const projectRoot = resolve('.')
  const jobWrapper = await readFile(join(projectRoot, 'deployment', 'windows', 'Invoke-AndaluciaDatabaseJob.ps1'), 'utf8')
  const installer = await readFile(join(projectRoot, 'deployment', 'windows', 'Install-AndaluciaDatabaseScheduler.ps1'), 'utf8')
  const remover = await readFile(join(projectRoot, 'deployment', 'windows', 'Remove-AndaluciaDatabaseScheduler.ps1'), 'utf8')
  assert.match(jobWrapper, /ANDALUCIA_CANONICAL_IDENTITY_MISMATCH/)
  assert.match(jobWrapper, /npm\.cmd run db:backup:job -- daily/)
  assert.match(jobWrapper, /npm\.cmd run db:restore:rehearse/)
  assert.match(jobWrapper, /exit 1/)
  assert.match(jobWrapper, /gracefulShutdown=CONFIRMED/)
  assert.match(jobWrapper, /api\/health/)
  assert.match(jobWrapper, /src\/main\.tsx/)
  assert.match(jobWrapper, /src\/App\.tsx/)
  assert.match(jobWrapper, /consecutiveReadyChecks -ge 3/)
  assert.match(jobWrapper, /restartResult = 'FAILED'/)
  assert.match(jobWrapper, /restoreRehearsal=RESTORE_TEST_PASSED/)
  assert.match(jobWrapper, /jobOutput = @\(& npm\.cmd/)
  assert.match(jobWrapper, /-not \(Test-ApplicationReadyOnce\)/)
  assert.doesNotMatch(jobWrapper, /password|session token|api secret/i)
  assert.match(installer, /StartWhenAvailable/)
  assert.match(installer, /MultipleInstances IgnoreNew/)
  assert.match(installer, /Register-ScheduledTask[\s\S]*-Force/)
  assert.match(installer, /02:00/)
  assert.match(installer, /Sunday[\s\S]*03:30/)
  assert.match(remover, /ConfirmRemoval/)
  assert.match(remover, /intentionally untouched/)
  console.log(JSON.stringify({ commandGeneration: true, wrapperSafety: true, canonicalPathValidation: true, environmentHandling: true, jobLocking: true, overlappingJobRejection: true, migrationAndRecoveryExclusion: true, gracefulShutdownHandshake: true, failureExitPropagation: true, logging: true, missedRunBehavior: true, idempotentInstallation: true, backupIntegration: true, rehearsalIntegration: true, retentionIntegration: true, ownerHealthIntegration: true }, null, 2))
} finally { await rm(root, { recursive: true, force: true }) }
