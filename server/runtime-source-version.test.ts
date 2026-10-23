import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const fixture = await createDisposableStoreThrough('runtime-source-version', '027')
await fixture.db.close()
const children: ChildProcess[] = []
const sleep = (milliseconds: number) => new Promise(resolveWait => setTimeout(resolveWait, milliseconds))
const port = await new Promise<number>((resolvePort, rejectPort) => {
  const reservation = createServer()
  reservation.once('error', rejectPort)
  reservation.listen(0, '127.0.0.1', () => {
    const address = reservation.address()
    if (!address || typeof address === 'string') return reservation.close(() => rejectPort(new Error('RUNTIME_VERSION_PORT_RESERVATION_FAILED')))
    const selected = address.port
    reservation.close(error => error ? rejectPort(error) : resolvePort(selected))
  })
})
const sourceSha = '0123456789abcdef0123456789abcdef01234567'

try {
  children.push(spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    cwd: resolve('.'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ANDALUCIA_DATA_DIR: fixture.store,
      ANDALUCIA_STORE_ROLE: 'development',
      ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store,
      ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027',
      ANDALUCIA_ACTIVE_SOURCE_SHA: sourceSha,
      ANDALUCIA_ACTIVE_SOURCE_BRANCH: 'main',
      API_PORT: String(port)
    },
    stdio: 'inherit'
  }))
  let health: any = null
  let healthError = ''
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (response.ok) { health = await response.json(); break }
      healthError = `${response.status} ${await response.text()}`
    } catch (error) { healthError = error instanceof Error ? error.message : String(error) }
    await sleep(100)
  }
  assert(health, `Runtime health unavailable: ${healthError}`)
  assert.deepEqual(health.application, { sha: sourceSha, branch: 'main', schema: '027' })
  assert.equal(health.database.migrationVersion, '027')
  assert.equal(health.database.recoveryRequired, false)
  console.log(JSON.stringify({ activeSourceDiagnostic: true, sourceSha, branch: 'main', schema: '027', canonicalDatabaseTouched: false }, null, 2))
} finally {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : Promise.race([
    new Promise<void>(resolveExit => child.once('exit', () => resolveExit())),
    sleep(5_000)
  ])))
  for (let attempt = 0; attempt < 50 && existsSync(join(fixture.store, 'postmaster.pid')); attempt++) await sleep(100)
  await fixture.cleanup()
}
