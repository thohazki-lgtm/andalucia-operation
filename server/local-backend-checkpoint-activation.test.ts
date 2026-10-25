import assert from 'node:assert/strict'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createDisposableTestRoot } from './test-store-fixture.js'

const sourceRoot = resolve('.')
const testRoot = await createDisposableTestRoot('local-backend-checkpoint-activation')
const expectedCheckpoint = 'f9cd8b03db9d55205e37783aedd141335a9a11e0'
const expectedReviewUiCheckpoint = 'bbc348a7cf9ca672d0371ecf35fd2f157f3f27fe'
const expectedFinalReviewUiCheckpoint = '6110fd6e6da9f311d5be880eb3a277cb51caae3f'
const expectedCoverCheckpoint = '1e3c1001ec6746e8fd627960ef2ee5ef1cd3f2b0'

function run(command: string, args: string[], cwd = testRoot, expectSuccess = true) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (expectSuccess) assert.equal(result.status, 0, output)
  return { ...result, output }
}

try {
  const deploymentRoot = join(testRoot, 'deployment', 'windows')
  await mkdir(join(testRoot, 'server'), { recursive: true })
  await mkdir(join(testRoot, 'src'), { recursive: true })
  await mkdir(deploymentRoot, { recursive: true })
  for (const file of ['Resolve-AndaluciaApprovedSource.ps1', 'Approve-AndaluciaLocalBackendCheckpoint.ps1', 'Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1']) {
    await cp(join(sourceRoot, 'deployment', 'windows', file), join(deploymentRoot, file))
  }
  for (const file of ['Resolve-AndaluciaApprovedSource.ps1', 'Approve-AndaluciaLocalBackendCheckpoint.ps1', 'Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1']) {
    const path = join(deploymentRoot, file).replaceAll("'", "''")
    const parsed = run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `[void][ScriptBlock]::Create((Get-Content -LiteralPath '${path}' -Raw))`])
    assert.equal(parsed.status, 0)
  }

  await writeFile(join(testRoot, 'server', 'daily-report-service.ts'), 'export const version = 1\n', 'utf8')
  run('git', ['init', '-b', 'main'])
  run('git', ['config', 'user.email', 'backend-checkpoint-test@andalucia.invalid'])
  run('git', ['config', 'user.name', 'Andalucia Backend Checkpoint Test'])
  run('git', ['add', '.'])
  run('git', ['commit', '-m', 'fixture baseline'])
  const baseline = run('git', ['rev-parse', 'HEAD']).stdout.trim()
  await writeFile(join(testRoot, 'server', 'daily-report-service.ts'), 'export const version = 2\n', 'utf8')
  run('git', ['add', 'server/daily-report-service.ts'])
  run('git', ['commit', '-m', 'reviewed backend change'])
  const checkpoint = run('git', ['rev-parse', 'HEAD']).stdout.trim()

  const resolver = join(deploymentRoot, 'Resolve-AndaluciaApprovedSource.ps1').replaceAll("'", "''")
  const root = testRoot.replaceAll("'", "''")
  const exact = run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-Command', `. '${resolver}'; Assert-AndaluciaExactChangedPaths -ProjectRoot '${root}' -From '${baseline}' -To '${checkpoint}' -ExpectedPaths @('server/daily-report-service.ts') -Code 'TEST_PATH_MISMATCH'`])
  assert.match(exact.output, /server\/daily-report-service\.ts/)
  const unexpected = run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-Command', `. '${resolver}'; Assert-AndaluciaExactChangedPaths -ProjectRoot '${root}' -From '${baseline}' -To '${checkpoint}' -ExpectedPaths @('server/other.ts') -Code 'TEST_PATH_MISMATCH'`], testRoot, false)
  assert.notEqual(unexpected.status, 0)
  assert.match(unexpected.output, /TEST_PATH_MISMATCH/)

  const approvalPath = join(deploymentRoot, 'Approve-AndaluciaLocalBackendCheckpoint.ps1')
  const wrongCheckpoint = run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', approvalPath, '-ReviewedCheckpointSha', checkpoint, '-ControlCommitSha', checkpoint, '-ManagerApproval', 'YES_I_APPROVE_EXACT_DAILY_REPORT_BACKEND_CHECKPOINT', '-RepositoryRoot', testRoot], testRoot, false)
  assert.notEqual(wrongCheckpoint.status, 0)
  assert.match(wrongCheckpoint.output, /ANDALUCIA_LOCAL_BACKEND_CHECKPOINT_SHA_NOT_APPROVED/)
  const wrongReviewUi = run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', approvalPath, '-ReviewedCheckpointSha', expectedCheckpoint, '-ReviewUiCheckpointSha', checkpoint, '-ControlCommitSha', checkpoint, '-ManagerApproval', 'YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_UI_CHECKPOINT', '-RepositoryRoot', testRoot], testRoot, false)
  assert.notEqual(wrongReviewUi.status, 0)
  assert.match(wrongReviewUi.output, /ANDALUCIA_LOCAL_BACKEND_UI_CHECKPOINT_SHA_NOT_APPROVED/)
  const wrongFinalReviewUi = run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', approvalPath, '-ReviewedCheckpointSha', expectedCheckpoint, '-FinalReviewUiCheckpointSha', checkpoint, '-ControlCommitSha', checkpoint, '-ManagerApproval', 'YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_FINAL_UI_CHECKPOINT', '-RepositoryRoot', testRoot], testRoot, false)
  assert.notEqual(wrongFinalReviewUi.status, 0)
  assert.match(wrongFinalReviewUi.output, /ANDALUCIA_LOCAL_BACKEND_FINAL_UI_CHECKPOINT_SHA_NOT_APPROVED/)

  const resolverSource = await readFile(join(deploymentRoot, 'Resolve-AndaluciaApprovedSource.ps1'), 'utf8')
  const approvalSource = await readFile(approvalPath, 'utf8')
  const activationSource = await readFile(join(deploymentRoot, 'Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1'), 'utf8')
  assert.match(resolverSource, new RegExp(expectedCheckpoint))
  assert.match(resolverSource, new RegExp(expectedReviewUiCheckpoint))
  assert.match(resolverSource, new RegExp(expectedFinalReviewUiCheckpoint))
  assert.match(approvalSource, new RegExp(expectedCheckpoint))
  assert.match(approvalSource, new RegExp(expectedReviewUiCheckpoint))
  assert.match(approvalSource, new RegExp(expectedFinalReviewUiCheckpoint))
  assert.doesNotMatch(approvalSource, /\*\.ts|server\/\*/)
  assert.match(resolverSource, /approved_local_daily_report_backend_checkpoint/)
  assert.match(resolverSource, /approved_local_daily_report_backend_with_review_ui/)
  assert.match(resolverSource, /approved_local_daily_report_backend_with_final_review_ui/)
  assert.match(activationSource, new RegExp(expectedCheckpoint))
  assert.match(activationSource, new RegExp(expectedReviewUiCheckpoint))
  assert.match(activationSource, new RegExp(expectedFinalReviewUiCheckpoint))
  assert.match(resolverSource, new RegExp(expectedCoverCheckpoint))
  assert.match(approvalSource, new RegExp(expectedCoverCheckpoint))
  assert.match(activationSource, new RegExp(expectedCoverCheckpoint))
  assert.match(resolverSource, /approved_local_daily_report_cover_reconciliation/)
  assert.match(approvalSource, /YES_I_APPROVE_EXACT_DAILY_REPORT_COVER_CHECKPOINT/)
  assert.match(activationSource, /YES_I_APPROVE_EXACT_DAILY_REPORT_COVER_ACTIVATION/)
  assert.match(activationSource, /VERIFIED_RECENT_BACKUP_REQUIRED/)
  assert.match(activationSource, /RUNTIME_TASK_SAFETY_DRIFT/)
  assert.match(activationSource, /GUARDED_SHUTDOWN_RELEASE_NOT_VERIFIED/)
  assert.doesNotMatch(activationSource, /Remove-Item|Stop-Process|taskkill/)

  console.log(JSON.stringify({ disposableRepository: true, powershellSyntax: true, exactPathAllowlist: true, unexpectedPathRejected: true, wrongCheckpointRejected: true, wrongReviewUiRejected: true, wrongFinalReviewUiRejected: true, exactCheckpoint: expectedCheckpoint, exactReviewUiCheckpoint: expectedReviewUiCheckpoint, exactFinalReviewUiCheckpoint: expectedFinalReviewUiCheckpoint, exactCoverCheckpoint: expectedCoverCheckpoint, recentBackupRequired: true, schedulerSafetyRequired: true, gracefulReleaseRequired: true, destructiveRecoveryAbsent: true, generalBackendAuthorization: false, canonicalDatabaseTouched: false }, null, 2))
} finally {
  await rm(testRoot, { recursive: true, force: true })
}
