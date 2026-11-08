import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { acknowledgeGuardedStartupHealth } from './guarded-startup-observability.ts'
import { publicDatabaseHealth } from './database-protection.ts'

const root = resolve('.')
const fixture = await mkdtemp(join(tmpdir(), 'andalucia-startup-observability-'))
try {
  const log = join(fixture, 'guarded-startup.jsonl')
  await writeFile(log, [
    JSON.stringify({ version: 'andalucia-guarded-startup-v1', recordedAt: '2026-11-08T00:00:00.000Z', state: 'STARTING', detail: 'old attempt' }),
    JSON.stringify({ version: 'andalucia-guarded-startup-v1', recordedAt: '2026-11-08T00:00:01.000Z', state: 'FAILED', detail: 'OLD_FAILURE' }),
    JSON.stringify({ version: 'andalucia-guarded-startup-v1', recordedAt: '2026-11-08T01:00:00.000Z', state: 'STARTING', detail: 'current attempt' }),
    JSON.stringify({ version: 'andalucia-guarded-startup-v1', recordedAt: '2026-11-08T01:00:01.000Z', state: 'FAILED', detail: 'FIRST_CURRENT_FATAL' })
  ].join('\n') + '\n')

  const diagnostic = JSON.parse(execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', resolve('deployment/windows/Get-AndaluciaStartupDiagnostic.ps1'), '-RepositoryRoot', root, '-StartupLogPath', log, '-NoLiveProbe'], { encoding: 'utf8' }))
  assert.equal(diagnostic.firstFatalError.cause, 'FIRST_CURRENT_FATAL')
  assert.equal(diagnostic.frontend.status, 'NOT_CHECKED')
  assert.equal(diagnostic.backend.status, 'NOT_CHECKED')

  const acknowledged = acknowledgeGuardedStartupHealth({ sha: 'a'.repeat(40), branch: 'main', storeId: 'andalucia-canonical-live', schema: '027', databaseStatus: 'HEALTHY' }, log)
  assert.equal(acknowledged, true)
  const records = (await readFile(log, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line))
  assert.equal(records.at(-1).state, 'HEALTH_ACKNOWLEDGED')
  assert.match(records.at(-1).detail, /storeId=andalucia-canonical-live/)

  const publicHealth = publicDatabaseHealth({ status: 'HEALTHY', storeId: 'andalucia-canonical-live', storeRole: 'canonical', migrationVersion: '027', migrationRequired: false, recoveryRequired: false, lastVerifiedBackup: null, checks: [] })
  assert.equal(publicHealth.storeId, 'andalucia-canonical-live', 'the protected pre-shutdown binding must receive the canonical store identity')

  const launcher = await readFile(resolve('deployment/windows/Start-AndaluciaGuardedApplication.ps1'), 'utf8')
  assert.match(launcher, /ANDALUCIA_GUARDED_STARTUP_LOG/)
  assert.match(launcher, /Tee-Object -FilePath \$runtimeOutputLog/)
  assert.match(launcher, /firstFatal=/)

  const activation = await readFile(resolve('deployment/windows/Invoke-AndaluciaApprovedUiActivation.ps1'), 'utf8')
  const preflight = activation.indexOf('$preflightOutput = & powershell.exe @preflightArguments')
  const stop = activation.indexOf('& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $stopScript')
  const start = activation.indexOf('Start-ScheduledTask -TaskName $runtimeTaskName')
  assert.ok(preflight > -1 && stop > preflight && start > stop, 'candidate preflight must finish before a healthy runtime can be stopped or replaced')
  assert.match(activation, /GUARDED_START_HEALTH_VERIFICATION_FAILED; guarded recovery authorization is required before any retry/)

  console.log(JSON.stringify({ latestAttemptFatalSelected: true, durableHealthAcknowledgement: true, canonicalStoreHealthBinding: true, nativeRuntimeOutputCaptured: true, preflightBeforeShutdown: true, failedActivationRequiresGuardedRecovery: true, canonicalDatabaseTouched: false }, null, 2))
} finally {
  await rm(fixture, { recursive: true, force: true })
}
