import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

await mkdir(resolve('.tmp-tests'), { recursive:true })
const root = await mkdtemp(resolve('.tmp-tests', 'andalucia-native-control-'))
try {
  const helper = resolve('deployment/windows/Invoke-AndaluciaNativeJsonControl.ps1')
  const success = join(root, 'success.mjs')
  const failure = join(root, 'failure.mjs')
  const harness = join(root, 'harness.ps1')
  await writeFile(success, `let input='';for await(const chunk of process.stdin)input+=chunk;const value=JSON.parse(input);process.stderr.write('DISPOSABLE_DIAGNOSTIC\\n');process.stdout.write(JSON.stringify({state:'RECOVERY_HEALTHY',schema:'027',identifier:value.identifier,passwordLength:value.password.length}));`)
  await writeFile(failure, `process.stderr.write('DB3_SYNTHETIC_UNDERLYING_FAILURE\\n');process.exitCode=23;`)
  await writeFile(harness, `param([string]$Helper,[string]$Node,[string]$Script)\n$ErrorActionPreference='Stop'\n. $Helper\n$payload=@{identifier='synthetic-manager';password='Synthetic-Password-123'}|ConvertTo-Json -Compress\ntry { Invoke-AndaluciaNativeJsonControl -ExecutablePath $Node -ArgumentList @($Script) -Payload $payload } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 31 } finally { $payload=$null }\n`)
  const node = process.execPath
  const ok = execFileSync('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',harness,'-Helper',helper,'-Node',node,'-Script',success], { encoding:'utf8' })
  const parsed = JSON.parse(ok.trim())
  assert.equal(parsed.state, 'RECOVERY_HEALTHY'); assert.equal(parsed.schema, '027'); assert.equal(parsed.identifier, 'synthetic-manager'); assert.equal(parsed.passwordLength, 22)
  const bad = spawnSync('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',harness,'-Helper',helper,'-Node',node,'-Script',failure], { encoding:'utf8' })
  assert.notEqual(bad.status, 0)
  assert.match(bad.stderr, /DB3_SYNTHETIC_UNDERLYING_FAILURE/)
  assert.doesNotMatch(bad.stderr, /NativeCommandError/)

  const wrapper = await readFile(resolve('deployment/windows/Invoke-AndaluciaDb3StaleMarkerRecovery.ps1'), 'utf8')
  const helperSource = await readFile(helper, 'utf8')
  assert.match(helperSource, /RedirectStandardError/)
  assert.doesNotMatch(wrapper, /2>&1/)
  assert.doesNotMatch(wrapper, /password[^\n]+ArgumentList/i)
  console.log('DB3 native invocation security test passed.')
} finally { await rm(root, { recursive:true, force:true }) }
