import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const watcher = resolve('deployment/windows/Watch-AndaluciaWindowsShutdown.ps1')
const serviceSource = resolve('deployment/windows/AndaluciaWindowsShutdownService.cs')
const serviceInstaller = resolve('deployment/windows/Install-AndaluciaWindowsShutdownService.ps1')
const schedulerInstaller = resolve('deployment/windows/Install-AndaluciaDatabaseScheduler.ps1')
const roots = []
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms))

const fixture = async role => {
  const root = await mkdtemp(join(tmpdir(), 'andalucia-scm-shutdown-')); roots.push(root)
  const data = join(root, '.data', 'postgres')
  await mkdir(data, { recursive: true })
  await mkdir(join(root, '.runtime', 'logs'), { recursive: true })
  await writeFile(join(root, '.data', 'andalucia-store-identity.json'), JSON.stringify({ role, storeId: 'disposable-scm-shutdown', databaseDirectory: data }))
  await writeFile(join(data, 'postmaster.pid'), '-42\n/pglite/data\n1\n5432\n')
  return { root, marker: join(data, 'postmaster.pid'), signal: join(root, '.backups', '.db2', 'scheduler', 'control', 'windows-shutdown.signal'), responses: join(root, '.backups', '.db2', 'scheduler', 'control', 'responses') }
}

const compile = async root => {
  const output = join(root, 'AndaluciaWindowsShutdownService.exe')
  const command = `$ErrorActionPreference='Stop'; Add-Type -Path '${serviceSource.replaceAll("'", "''")}' -OutputAssembly '${output.replaceAll("'", "''")}' -OutputType ConsoleApplication`
  await exec('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command, 'utf16le').toString('base64')], { timeout: 30000 })
  await writeFile(join(root, 'Watch-AndaluciaWindowsShutdown.ps1'), await readFile(watcher))
  return output
}

const runSimulation = (exe, fixture, timeout = 5) => new Promise(resolveRun => {
  const child = spawn(exe, ['--project-root',fixture.root,'--timeout-seconds',String(timeout),'--simulate-preshutdown'], { stdio: ['ignore','pipe','pipe'] })
  let out = '', err = ''
  child.stdout.on('data', data => { out += data })
  child.stderr.on('data', data => { err += data })
  child.on('exit', code => resolveRun({ code, out, err }))
})

const runProcess = (command, args) => new Promise(resolveRun => {
  const child = spawn(command, args, { stdio: ['ignore','pipe','pipe'] })
  let out = '', err = ''
  child.stdout.on('data', data => { out += data })
  child.stderr.on('data', data => { err += data })
  child.on('exit', code => resolveRun({ code, out, err }))
})

try {
  const [watcherText, serviceText, installerText, schedulerText] = await Promise.all([watcher, serviceSource, serviceInstaller, schedulerInstaller].map(path => readFile(path, 'utf8')))
  assert.doesNotMatch(watcherText, /Register-ObjectEvent|SystemEvents|SessionEnding/)
  assert.match(watcherText, /WINDOWS_SCM_PRESHUTDOWN/)
  assert.doesNotMatch(watcherText, /Remove-Item[^\n]+postmaster|unlink[^\n]+postmaster/i)
  assert.match(serviceText, /ServiceControlPreshutdown\s*=\s*0xF/)
  assert.match(serviceText, /ServiceAcceptPreshutdown\s*=\s*0x100/)
  assert.match(serviceText, /Interlocked\.CompareExchange\(ref shutdownStarted, 1, 0\)/)
  assert.match(serviceText, /-PreshutdownOnce/)
  assert.match(serviceText, /SHUTDOWN_SERVICE_HANDSHAKE_INTEGRITY_MISMATCH/)
  assert.match(serviceText, /WaitForExit\(\(timeoutSeconds \+ 5\) \* 1000\)/)
  assert.match(installerText, /'obj=',\s*'NT AUTHORITY\\LocalService'/)
  assert.match(installerText, /SHUTDOWN_SERVICE_SID_CONFIGURATION_FAILED[^\n]+sidtype[^\n]+restricted/)
  assert.doesNotMatch(installerText, /-Arguments\s+@\('preshutdown'/, 'installer must not call the unsupported sc.exe preshutdown command')
  assert.match(installerText, /Set-AndaluciaPreshutdownTimeout[^\n]+-TimeoutMs 60000/)
  assert.match(installerText, /New-ItemProperty[^\n]+PreshutdownTimeout[^\n]+PropertyType DWord/)
  assert.match(installerText, /SHUTDOWN_SERVICE_PRESHUTDOWN_CONFIGURATION_MISMATCH/)
  assert.match(installerText, /Get-Item -LiteralPath \$gitMetadata -Force/, 'hidden authoritative .git metadata must remain discoverable')
  assert.match(installerText, /System32\\sc\.exe/)
  assert.match(installerText, /\$nativeOutput = @\(& \$scExecutable @Arguments 2>&1\)/)
  assert.match(installerText, /WIN32_EXIT_\{1\}/)
  assert.match(installerText, /SHUTDOWN_SERVICE_CREATE_FAILED/)
  assert.doesNotMatch(installerText, /sc\.exe create[^\n]+\| Out-Null/)
  assert.match(installerText, /ProgramFiles[^\n]+ShutdownGuard/)
  assert.match(installerText, /inheritance:r[^\n]+SYSTEM:\(OI\)\(CI\)\(F\)[^\n]+Administrators:\(OI\)\(CI\)\(F\)[^\n]+\(OI\)\(CI\)\(RX\)/)
  assert.doesNotMatch(installerText, /LocalSystem|SYSTEM_ACCOUNT/i)
  assert.match(schedulerText, /Install-AndaluciaWindowsShutdownService\.ps1/)
  assert.doesNotMatch(schedulerText, /Register-GracefulShutdownTask|New-ScheduledTaskTrigger -AtLogOn[^\n]+shutdown/i)

  const nativeDiagnosticFixture = `
    $ErrorActionPreference = 'Stop'
    $installerPath = '${serviceInstaller.replaceAll("'", "''")}'
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($installerPath,[ref]$tokens,[ref]$errors)
    if ($errors.Count -ne 0) { throw 'INSTALLER_PARSE_FAILED' }
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-AndaluciaScCommand' }, $true)
    if (-not $definition) { throw 'SC_DIAGNOSTIC_FUNCTION_MISSING' }
    . ([scriptblock]::Create($definition.Extent.Text))
    $scExecutable = Join-Path $env:SystemRoot 'System32\\sc.exe'
    try {
      Invoke-AndaluciaScCommand -FailureCode 'DISPOSABLE_SERVICE_QUERY_FAILED' -Arguments @('query','AndaluciaDisposableServiceThatMustNotExist') | Out-Null
      throw 'EXPECTED_NATIVE_FAILURE_MISSING'
    } catch {
      if ($_.Exception.Message -notmatch 'DISPOSABLE_SERVICE_QUERY_FAILED:WIN32_EXIT_1060:' -or $_.Exception.Message -notmatch 'does not exist') { throw }
      Write-Output $_.Exception.Message
    }
  `
  const nativeDiagnostic = await exec('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(nativeDiagnosticFixture, 'utf16le').toString('base64')], { timeout: 30000 })
  assert.match(nativeDiagnostic.stdout, /WIN32_EXIT_1060/)

  const argvRoot = await mkdtemp(join(tmpdir(), 'andalucia-scm-argv-')); roots.push(argvRoot)
  const argvProbe = join(argvRoot, 'argv-probe.mjs')
  await writeFile(argvProbe, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
  const nativeArgumentFixture = String.raw`
    $ErrorActionPreference = 'Stop'
    $installerPath = '${serviceInstaller.replaceAll("'", "''")}'
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($installerPath,[ref]$tokens,[ref]$errors)
    if ($errors.Count -ne 0) { throw 'INSTALLER_PARSE_FAILED' }
    $assignment = $ast.Find({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left -is [Management.Automation.Language.VariableExpressionAst] -and $node.Left.VariablePath.UserPath -eq 'binaryPath' }, $true)
    if (-not $assignment) { throw 'SC_BINARY_PATH_ASSIGNMENT_MISSING' }
    $serviceExe = 'C:\Program Files\ANDALUCIA OPERATION\ShutdownGuard\AndaluciaWindowsShutdownService.exe'
    $root = 'C:\Users\Disposable SCM Fixture'
    $approved = [pscustomobject]@{ Sha = '${'1'.repeat(40)}' }
    $git = 'C:\Program Files\Git\cmd\git.exe'
    $handshakeSha256 = '${'a'.repeat(64)}'
    . ([scriptblock]::Create($assignment.Extent.Text))
    & '${process.execPath.replaceAll("'", "''")}' '${argvProbe.replaceAll("'", "''")}' $binaryPath
  `
  const nativeArgument = await exec('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(nativeArgumentFixture, 'utf16le').toString('base64')], { timeout: 30000 })
  const serializedArguments = JSON.parse(nativeArgument.stdout)
  assert.equal(serializedArguments.length, 1, 'Windows PowerShell 5.1 must pass binPath as one native argument')
  assert.match(serializedArguments[0], /^"C:\\Program Files\\ANDALUCIA OPERATION\\ShutdownGuard\\AndaluciaWindowsShutdownService\.exe"/)
  assert.match(serializedArguments[0], /--project-root "C:\\Users\\Disposable SCM Fixture"/)
  assert.match(serializedArguments[0], /--git-path "C:\\Program Files\\Git\\cmd\\git\.exe"/)

  const timeoutRegistryFixture = `
    $ErrorActionPreference = 'Stop'
    $installerPath = '${serviceInstaller.replaceAll("'", "''")}'
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($installerPath,[ref]$tokens,[ref]$errors)
    if ($errors.Count -ne 0) { throw 'INSTALLER_PARSE_FAILED' }
    $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Set-AndaluciaPreshutdownTimeout' }, $true)
    if (-not $function) { throw 'PRESHUTDOWN_TIMEOUT_FUNCTION_MISSING' }
    . ([scriptblock]::Create($function.Extent.Text))
    $script:captured = $null
    function New-ItemProperty {
      param([string]$LiteralPath,[string]$Name,[string]$PropertyType,[int]$Value,[switch]$Force)
      $script:captured = [pscustomobject]@{ LiteralPath=$LiteralPath; Name=$Name; PropertyType=$PropertyType; Value=$Value; Force=[bool]$Force }
    }
    function Get-ItemPropertyValue { param([string]$LiteralPath,[string]$Name); return 60000 }
    Set-AndaluciaPreshutdownTimeout -RegistryPath 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Disposable' -TimeoutMs 60000
    if ($script:captured.LiteralPath -ne 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Disposable' -or $script:captured.Name -ne 'PreshutdownTimeout' -or $script:captured.PropertyType -ne 'DWord' -or $script:captured.Value -ne 60000 -or -not $script:captured.Force) { throw 'PRESHUTDOWN_TIMEOUT_DISPOSABLE_VALIDATION_FAILED' }
  `
  await exec('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(timeoutRegistryFixture, 'utf16le').toString('base64')], { timeout: 30000 })

  const good = await fixture('disposable')
  const exe = await compile(good.root)
  const architecture = await exec('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-Command',`[Reflection.AssemblyName]::GetAssemblyName('${exe.replaceAll("'", "''")}').ProcessorArchitecture`])
  assert.match(architecture.stdout, /MSIL/, 'shutdown service must be AnyCPU/MSIL for Windows ARM64 compatibility')
  const handshakeSha = createHash('sha256').update(await readFile(watcher)).digest('hex')
  const gitPath = (await exec('where.exe', ['git.exe'])).stdout.split(/\r?\n/).find(Boolean)
  await exec(gitPath, ['init','-b','main'], { cwd: good.root })
  await exec(gitPath, ['config','user.email','synthetic@example.invalid'], { cwd: good.root })
  await exec(gitPath, ['config','user.name','Synthetic Test'], { cwd: good.root })
  await exec(gitPath, ['add','.'], { cwd: good.root })
  await exec(gitPath, ['commit','-m','disposable fixture'], { cwd: good.root })
  const wrongSource = await runProcess(exe, ['--project-root',good.root,'--expected-sha','0000000000000000000000000000000000000000','--git-path',gitPath,'--handshake-sha256',handshakeSha])
  assert.notEqual(wrongSource.code, 0)
  assert.match(wrongSource.err + wrongSource.out, /SHUTDOWN_SERVICE_SOURCE_BINDING_MISMATCH/)
  const pending = runSimulation(exe, good, 8)
  for (let i = 0; i < 150 && !existsSync(good.signal); i++) await delay(100)
  if (!existsSync(good.signal)) {
    const early = await pending
    const logPath = join(good.root, '.runtime', 'logs', 'windows-shutdown-watcher.jsonl')
    const log = existsSync(logPath) ? await readFile(logPath, 'utf8') : 'NO_WATCHER_LOG'
    assert.fail(`SCM simulation did not emit the guarded backend shutdown signal (exit ${early.code}): ${early.err}${early.out}; ${log}`)
  }
  await mkdir(good.responses, { recursive: true })
  await rm(good.marker)
  await writeFile(join(good.responses, 'completed.json'), JSON.stringify({ requestId:'disposable', state:'completed', completedAt:new Date().toISOString(), source:'windows_shutdown_signal' }))
  const success = await pending
  assert.equal(success.code, 0, success.err + success.out)
  assert.match(await readFile(join(good.root, '.runtime', 'logs', 'windows-shutdown-watcher.jsonl'), 'utf8'), /ACKNOWLEDGED/)

  const timeout = await fixture('test')
  const failed = await runSimulation(exe, timeout, 5)
  assert.notEqual(failed.code, 0)
  assert(existsSync(timeout.marker), 'timeout path must preserve database ownership marker')
  assert.match(await readFile(join(timeout.root, '.runtime', 'logs', 'windows-shutdown-watcher.jsonl'), 'utf8'), /SHUTDOWN_WATCHER_ACKNOWLEDGEMENT_TIMEOUT/)

  const canonical = await fixture('canonical')
  const rejected = await runSimulation(exe, canonical, 5)
  assert.notEqual(rejected.code, 0)
  assert.match(rejected.err + rejected.out, /SHUTDOWN_WATCHER_SIMULATION_CANONICAL_FORBIDDEN/)
  assert(existsSync(canonical.marker), 'simulation rejection must preserve canonical-looking marker fixture')

  const wrongStore = await fixture('test')
  const wrongStoreResult = await runProcess('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',watcher,'-ProjectRoot',wrongStore.root,'-PreshutdownOnce','-ScmValidatedSourceSha','1111111111111111111111111111111111111111','-TimeoutSeconds','5'])
  assert.notEqual(wrongStoreResult.code, 0)
  assert.match(wrongStoreResult.err + wrongStoreResult.out, /SHUTDOWN_WATCHER_CANONICAL_IDENTITY_MISMATCH/)
  assert(existsSync(wrongStore.marker), 'wrong-store rejection must preserve ownership marker')
  console.log('Windows SCM preshutdown service security and disposable lifecycle tests passed.')
} finally {
  await Promise.all(roots.map(root => rm(root, { recursive:true, force:true })))
}
