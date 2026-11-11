import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const sourceRoot = resolve('.')
const activation = await readFile(resolve('deployment/windows/Invoke-AndaluciaApprovedUiActivation.ps1'), 'utf8')
const readyGate = activation.indexOf("GUARDED_RUNTIME_TASK_NOT_READY_AFTER_SHUTDOWN")
const stoppedRuntimeClaim = activation.indexOf('requested-backup-activation-control.ts') > -1 ? activation.indexOf('$claimOutput = & $tsxCommand') : -1
const startRequest = activation.indexOf('Start-ScheduledTask -TaskName $runtimeTaskName')
const startEvidence = activation.indexOf("GUARDED_RUNTIME_TASK_START_NOT_OBSERVED")
const healthVerification = activation.indexOf("Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health'")
assert.ok(readyGate > 0, 'guarded activation must fail closed until the prior task instance is fully ready')
assert.ok(stoppedRuntimeClaim > readyGate, 'a stopped-runtime authorization must not be claimed before the task is ready to start')
assert.ok(startRequest > readyGate, 'the scheduled task must not be started before the ready-state gate')
assert.ok(startEvidence > startRequest, 'a new launcher instance must be observed after the start request')
assert.ok(healthVerification > startEvidence, 'health verification must begin only after a new launcher record is observed')
assert.match(activation, /\$runtimeTask\.State -eq 'Ready'/)
assert.match(activation, /\.state -ne 'STARTING'/)
assert.match(activation, /\.recordedAt/)

const reservePort = () => new Promise<number>((resolvePort, rejectPort) => {
  const reservation = createServer()
  reservation.once('error', rejectPort)
  reservation.listen(0, '127.0.0.1', () => {
    const address = reservation.address()
    if (!address || typeof address === 'string') return reservation.close(() => rejectPort(new Error('ISOLATED_PORT_RESERVATION_FAILED')))
    const port = address.port
    reservation.close(error => error ? rejectPort(error) : resolvePort(port))
  })
})
const waitFor = async (url: string) => {
  let last = ''
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      last = `${response.status} ${await response.text()}`
    } catch (error) { last = error instanceof Error ? error.message : String(error) }
    await new Promise(done => setTimeout(done, 250))
  }
  throw new Error(`ISOLATED_RUNTIME_HEALTH_TIMEOUT:${url}:${last}`)
}

const fixture = await createDisposableDevelopmentStore('guarded-ui-activation-start-race')
const processes: ChildProcess[] = []
let output = ''
try {
  await fixture.db.close()
  const apiPort = await reservePort()
  const frontendPort = await reservePort()
  const node = process.execPath
  const runtimeEnvironment = {
    ...process.env,
    NODE_ENV: 'test',
    ANDALUCIA_DATA_DIR: fixture.store,
    ANDALUCIA_STORE_ROLE: 'development',
    ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store,
    ANDALUCIA_REQUIRED_SCHEMA_VERSION: '028',
    API_PORT: String(apiPort),
    APP_ORIGIN: `http://127.0.0.1:${frontendPort}`,
  }
  const api = spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: sourceRoot, env: runtimeEnvironment, stdio: ['ignore', 'pipe', 'pipe'] })
  const frontend = spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], { cwd: sourceRoot, env: runtimeEnvironment, stdio: ['ignore', 'pipe', 'pipe'] })
  processes.push(api, frontend)
  for (const process of processes) {
    process.stdout?.on('data', chunk => { output += String(chunk) })
    process.stderr?.on('data', chunk => { output += String(chunk) })
  }

  const healthResponse = await waitFor(`http://127.0.0.1:${apiPort}/api/health`)
  const health = await healthResponse.json() as { ok?: boolean; database?: { migrationVersion?: string; status?: string; migrationRequired?: boolean; recoveryRequired?: boolean } }
  assert.equal(health.ok, true)
  assert.equal(health.database?.migrationVersion, '028')
  assert.equal(health.database?.status, 'BACKUP_RECOMMENDED', 'the disposable store is healthy but intentionally has no operational backup')
  assert.equal(health.database?.migrationRequired, false)
  assert.equal(health.database?.recoveryRequired, false)

  const authentication = await waitFor(`http://127.0.0.1:${apiPort}/api/auth/bootstrap-status`)
  assert.equal(authentication.headers.get('content-type')?.includes('application/json'), true)
  const frontendResponse = await waitFor(`http://127.0.0.1:${frontendPort}/`)
  assert.match(await frontendResponse.text(), /<div id="root"><\/div>/)

  console.log(JSON.stringify({ scheduledTaskRaceGuarded: true, launcherStartEvidenceRequired: true, disposableSchema: health.database?.migrationVersion, backendHealth: 'PASS', frontendHealth: 'PASS', authenticationApi: 'PASS', canonicalDatabaseTouched: false }, null, 2))
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`)
} finally {
  for (const process of processes.reverse()) {
    if (process.exitCode === null) process.kill()
    process.removeAllListeners()
    process.unref()
  }
  await new Promise(done => setTimeout(done, 500))
  await fixture.cleanup()
}
