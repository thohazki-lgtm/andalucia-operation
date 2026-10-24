import assert from 'node:assert/strict'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createDisposableTestRoot } from './test-store-fixture.js'

const sourceRoot = resolve('.')
const testRoot = await createDisposableTestRoot('local-ui-activation')

function run(command: string, args: string[], cwd = testRoot, expectSuccess = true) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (expectSuccess) assert.equal(result.status, 0, output)
  return { ...result, output }
}

try {
  await mkdir(join(testRoot, 'src'), { recursive: true })
  await writeFile(join(testRoot, 'src', 'ui.ts'), "export const label = 'main'\n", 'utf8')
  run('git', ['init', '-b', 'main'])
  run('git', ['config', 'user.email', 'local-ui-test@andalucia.invalid'])
  run('git', ['config', 'user.name', 'Andalucia Local UI Test'])
  run('git', ['add', 'src/ui.ts'])
  run('git', ['commit', '-m', 'fixture main'])
  const mainSha = run('git', ['rev-parse', 'HEAD']).stdout.trim()
  run('git', ['update-ref', 'refs/remotes/origin/main', mainSha])
  run('git', ['switch', '-c', 'codex/local-ui-fixture'])
  await writeFile(join(testRoot, 'src', 'ui.ts'), "export const label = 'approved local ui'\n", 'utf8')
  run('git', ['add', 'src/ui.ts'])
  run('git', ['commit', '-m', 'approved local UI'])
  const uiSha = run('git', ['rev-parse', 'HEAD']).stdout.trim()

  for (const file of [
    'deployment/windows/Start-AndaluciaGuardedApplication.ps1',
    'deployment/windows/Resolve-AndaluciaApprovedSource.ps1',
    'deployment/windows/Approve-AndaluciaLocalUiCheckpoint.ps1',
  ]) {
    await mkdir(join(testRoot, file, '..'), { recursive: true })
    await cp(join(sourceRoot, file), join(testRoot, file))
  }
  run('git', ['add', 'deployment/windows'])
  run('git', ['commit', '-m', 'local UI activation controls'])
  const controlSha = run('git', ['rev-parse', 'HEAD']).stdout.trim()

  const approval = run('powershell.exe', [
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File',
    join(testRoot, 'deployment', 'windows', 'Approve-AndaluciaLocalUiCheckpoint.ps1'),
    '-RepositoryRoot', testRoot,
    '-SourceUiCheckpointSha', uiSha,
    '-ControlCommitSha', controlSha,
    '-ManagerApproval', 'YES_I_APPROVE_LOCAL_UI_CHECKPOINT',
  ])
  assert.match(approval.output, /APPROVED_LOCAL_UI_CHECKPOINT/)
  const manifest = JSON.parse(await readFile(join(testRoot, '.runtime', 'andalucia-local-ui-approval.json'), 'utf8'))
  assert.equal(manifest.approvedMainSha, mainSha)
  assert.equal(manifest.sourceUiCheckpointSha, uiSha)
  assert.equal(manifest.controlCommitSha, controlSha)
  assert.equal(manifest.activeSourceSha, controlSha)

  const verifyCommand = `. '${join(testRoot, 'deployment', 'windows', 'Resolve-AndaluciaApprovedSource.ps1').replaceAll("'", "''")}'; (Get-AndaluciaApprovedSourceState -ProjectRoot '${testRoot.replaceAll("'", "''")}' -ManifestPath '${join(testRoot, '.runtime', 'andalucia-local-ui-approval.json').replaceAll("'", "''")}').Mode`
  const verified = run('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-Command', verifyCommand])
  assert.match(verified.output, /approved_local_ui_checkpoint/)

  await writeFile(join(testRoot, 'src', 'ui.ts'), "export const label = 'dirty'\n", 'utf8')
  const dirty = run('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-Command', verifyCommand], testRoot, false)
  assert.notEqual(dirty.status, 0)
  assert.match(dirty.output, /ANDALUCIA_RUNTIME_SOURCE_DIRTY/)
  run('git', ['restore', 'src/ui.ts'])

  manifest.activeSourceSha = mainSha
  await writeFile(join(testRoot, '.runtime', 'andalucia-local-ui-approval.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const mismatched = run('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-Command', verifyCommand], testRoot, false)
  assert.notEqual(mismatched.status, 0)
  assert.match(mismatched.output, /ANDALUCIA_LOCAL_UI_APPROVAL_SOURCE_MISMATCH/)

  console.log(JSON.stringify({ disposableRepository: true, exactCheckpointApproval: true, trackedCleanRequired: true, manifestShaPinning: true, mainRollbackPreserved: true }, null, 2))
} finally {
  await rm(testRoot, { recursive: true, force: true })
}
