import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { join, resolve } from 'node:path'

const modulePath = resolve('deployment/windows/AndaluciaRuntimeListenerEvidence.psm1')
const tempParent = resolve('.tmp-tests')
await mkdir(tempParent, { recursive: true })
const fixtureRoot = await mkdtemp(join(tempParent, 'runtime-listener-'))

const psQuote = value => `'${String(value).replaceAll("'", "''")}'`
const runPowerShell = (body, expectSuccess = true) => {
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-Command', body], { encoding: 'utf8', windowsHide: true })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (expectSuccess) assert.equal(result.status, 0, output)
  else assert.notEqual(result.status, 0, output)
  return output
}

const probe = provider => `
Import-Module ${psQuote(modulePath)} -Force
$script:index = 0
$provider = ${provider}
Get-AndaluciaStableRuntimeListeners -RequiredStableSamples 3 -MaximumAttempts 5 -SampleDelayMilliseconds 0 -ConnectionProvider $provider -DelayProvider { param($ms) } | ConvertTo-Json -Depth 8
`

const transient = runPowerShell(probe(`{
  $script:index += 1
  if ($script:index -eq 1) { return @() }
  return @([pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=3001;OwningProcess=101},[pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=5173;OwningProcess=202})
}`))
assert.equal(JSON.parse(transient).Attempts, 4)

const missing = runPowerShell(probe(`{ @([pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=3001;OwningProcess=101}) }`), false)
assert.match(missing, /RUNTIME_LISTENER_AMBIGUOUS/)

const duplicate = runPowerShell(probe(`{ @(
  [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=3001;OwningProcess=101},
  [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=5173;OwningProcess=202},
  [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=5173;OwningProcess=303}
) }`), false)
assert.match(duplicate, /RUNTIME_LISTENER_AMBIGUOUS/)

const replaced = runPowerShell(probe(`{
  $script:index += 1
  $owner = if (($script:index % 2) -eq 0) { 202 } else { 303 }
  @([pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=3001;OwningProcess=101},[pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=5173;OwningProcess=$owner})
}`), false)
assert.match(replaced, /RUNTIME_LISTENER_AMBIGUOUS/)

const forbidden = runPowerShell(probe(`{ @(
  [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=3001;OwningProcess=101},
  [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=5173;OwningProcess=202},
  [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=5174;OwningProcess=404}
) }`), false)
assert.match(forbidden, /RUNTIME_LISTENER_AMBIGUOUS/)

const stoppedEmpty = runPowerShell(`
Import-Module ${psQuote(modulePath)} -Force
Get-AndaluciaStableRuntimeListeners -RequiredPorts @() -ForbiddenPorts @(3001,5173,5174) -RequiredStableSamples 3 -MaximumAttempts 5 -SampleDelayMilliseconds 0 -ConnectionProvider { @() } -DelayProvider { param($ms) } | ConvertTo-Json -Depth 8
`)
assert.equal(JSON.parse(stoppedEmpty).StableSamples, 3)
const stoppedOwnerPresent = runPowerShell(`
Import-Module ${psQuote(modulePath)} -Force
Get-AndaluciaStableRuntimeListeners -RequiredPorts @() -ForbiddenPorts @(3001,5173,5174) -RequiredStableSamples 3 -MaximumAttempts 5 -SampleDelayMilliseconds 0 -ConnectionProvider { @([pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=3001;OwningProcess=101}) } -DelayProvider { param($ms) }
`, false)
assert.match(stoppedOwnerPresent, /RUNTIME_LISTENER_AMBIGUOUS/)

const children = []
try {
  const serverPath = join(fixtureRoot, 'listener-fixture.mjs')
  await writeFile(serverPath, `import { createServer } from 'node:http'\nconst server=createServer((_,res)=>{res.writeHead(200);res.end('ok')})\nserver.listen(0,'127.0.0.1',()=>console.log(server.address().port))\n`, 'utf8')
  const startServer = async () => {
    const child = spawn(process.execPath, [serverPath], { cwd: fixtureRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    children.push(child)
    const [chunk] = await once(child.stdout, 'data')
    return { port: Number(String(chunk).trim()), pid: child.pid }
  }
  const servers = [await startServer(), await startServer()]
  for (const server of servers) assert.equal((await fetch(`http://127.0.0.1:${server.port}/`)).status, 200)
  const actual = runPowerShell(`
Import-Module ${psQuote(modulePath)} -Force
Get-AndaluciaStableRuntimeListeners -RequiredPorts @(${servers.map(server => server.port).join(',')}) -ForbiddenPorts @() -RequiredStableSamples 2 -MaximumAttempts 4 -SampleDelayMilliseconds 100 | ConvertTo-Json -Depth 8
`)
  const parsed = JSON.parse(actual)
  assert.equal(parsed.Listeners.length, 2)
  assert.equal(parsed.StableSamples, 2)
} finally {
  await Promise.all(children.map(async child => {
    if (child.exitCode === null) {
      child.kill()
      await once(child, 'exit')
    }
  }))
  await rm(fixtureRoot, { recursive: true, force: true })
}

console.log(JSON.stringify({ transientObservationRecovered: true, missingRejected: true, duplicateRejected: true, replacementRejected: true, forbiddenPortRejected: true, stoppedRuntimeEmptyVerified: true, stoppedRuntimeOwnerRejected: true, disposableRuntimeVerified: true }, null, 2))
