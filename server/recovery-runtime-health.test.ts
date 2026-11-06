import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdir, rename, rm, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { STORE_IDENTITY_AUTHORIZATION, createStoreIdentity, storeIdentityPath } from './database-protection.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const historicalSha = process.env.ANDALUCIA_RECOVERY_HEALTH_TEST_SHA?.trim()
if (!historicalSha || !/^[0-9a-f]{40}$/i.test(historicalSha)) throw new Error('ANDALUCIA_RECOVERY_HEALTH_TEST_SHA_REQUIRED')

const fixture = await createDisposableDevelopmentStore('recovery-runtime-health')
const canonicalRoot = fixture.root
const canonicalStore = join(canonicalRoot, '.data', 'postgres')
const authorizationId = randomBytes(16).toString('hex')
const sourceRoot = join(canonicalRoot, '.runtime', 'recovery-source', authorizationId)
const apiPort = 3398
const clientPort = 5598
const children: ChildProcess[] = []
let output = ''
const sleep = (milliseconds: number) => new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds))
const waitFor = async (url: string) => {
  const deadline = Date.now() + 45_000
  let last = 'no response'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      last = `HTTP ${response.status}`
    } catch (error) { last = error instanceof Error ? error.message : String(error) }
    await sleep(200)
  }
  throw new Error(`Timed out waiting for ${url}: ${last}\n${output}`)
}

try {
  await fixture.db.close()
  await mkdir(join(canonicalRoot, '.data'), { recursive: true })
  await rename(fixture.store, canonicalStore)
  await unlink(storeIdentityPath(fixture.store))
  await createStoreIdentity(canonicalStore, 'canonical', {
    authorization: STORE_IDENTITY_AUTHORIZATION,
    expectedCanonicalDirectory: canonicalStore,
    storeId: 'andalucia-disposable-recovery-health',
  })

  await mkdir(join(canonicalRoot, '.runtime', 'recovery-source'), { recursive: true })
  execFileSync('git', ['clone', '--quiet', '--no-checkout', '--shared', resolve('.'), sourceRoot], { windowsHide: true })
  execFileSync('git', ['-c', 'core.longpaths=true', 'checkout', '--quiet', '--detach', historicalSha], { cwd: sourceRoot, windowsHide: true })
  const checkedOutSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8', windowsHide: true }).trim()
  assert.equal(checkedOutSha, historicalSha)

  const environment = {
    ...process.env,
    NODE_ENV: 'test',
    ANDALUCIA_DATA_DIR: canonicalStore,
    ANDALUCIA_STORE_ROLE: 'canonical',
    ANDALUCIA_CANONICAL_STARTUP_AUTHORIZATION: 'YES_I_APPROVE_GUARDED_CANONICAL_STARTUP',
    ANDALUCIA_RECOVERY_AUTHORIZATION_ID: authorizationId,
    ANDALUCIA_EXPECTED_CANONICAL_DATA_DIR: canonicalStore,
    ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027',
    ANDALUCIA_ACTIVE_SOURCE_SHA: historicalSha,
    ANDALUCIA_ACTIVE_SOURCE_BRANCH: `recovery/${authorizationId}`,
    API_PORT: String(apiPort),
    APP_ORIGIN: `http://127.0.0.1:${clientPort}`,
    CI: 'true',
  }

  const api = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('server/recovery-runtime-bootstrap.mjs'), '--source-root', sourceRoot, '--canonical-root', canonicalRoot, '--authorization-id', authorizationId], {
    cwd: sourceRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const client = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(clientPort), '--strictPort', sourceRoot], {
    cwd: sourceRoot,
    env: { ...environment, API_PORT: String(apiPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const [name, child] of [['api', api], ['client', client]] as const) {
    children.push(child)
    child.stdout?.on('data', chunk => { output += `[${name}] ${String(chunk)}` })
    child.stderr?.on('data', chunk => { output += `[${name}:error] ${String(chunk)}` })
  }

  const [health, frontend] = await Promise.all([
    waitFor(`http://127.0.0.1:${apiPort}/api/health`),
    waitFor(`http://127.0.0.1:${clientPort}/`),
  ])
  const healthBody = await health.json() as { application?: { sha?: string }; database?: { migrationVersion?: string } }
  assert.equal(healthBody.application?.sha, historicalSha)
  assert.equal(healthBody.database?.migrationVersion, '027')
  assert.match(await frontend.text(), /<div id="root"><\/div>/)
  await sleep(1_000)
  assert.equal(api.exitCode, null, `Historical backend exited after health response.\n${output}`)
  assert.equal(client.exitCode, null, `Historical frontend exited after health response.\n${output}`)

  console.log(JSON.stringify({ historicalSha, backendHealth: 'PASS', frontendHealth: 'PASS', schema: healthBody.database?.migrationVersion, processesRemainedRunning: true }))
} finally {
  for (const child of children.reverse()) if (child.exitCode === null) child.kill()
  await sleep(500)
  await rm(canonicalRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 300 })
}
