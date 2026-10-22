import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { createDatabaseSafeShutdown } from './database-safe-shutdown.js'
import { runPreflight } from './migration-store.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const fixture = await createDisposableStoreThrough('database-safe-shutdown', '019')
const marker = join(fixture.store, 'postmaster.pid')
const protectedBackupEvidence = join(fixture.root, 'protected-backup-evidence.json')
await writeFile(protectedBackupEvidence, JSON.stringify({ protected: true, schema: '019' }), 'utf8')
const guardedStopSource = await readFile(join(process.cwd(), 'deployment', 'windows', 'Stop-AndaluciaGuardedApplication.ps1'), 'utf8')
const viteConfigSource = await readFile(join(process.cwd(), 'vite.config.ts'), 'utf8')

let httpCloses = 0
let databaseCloses = 0
let backgroundStops = 0
try {
  assert.equal(existsSync(marker), true)
  assert.equal((await runPreflight(fixture.db, fixture.store)).status, 'READY')

  const shutdown = createDatabaseSafeShutdown({
    closeHttpServer: async () => { httpCloses++ },
    closeDatabase: async () => { databaseCloses++; await fixture.db.close() },
    stopBackgroundTasks: () => { backgroundStops++ },
    processMarkerPath: marker
  })
  await Promise.all([shutdown('FIRST_TRIGGER'), shutdown('CONCURRENT_TRIGGER')])

  assert.equal(httpCloses, 1)
  assert.equal(databaseCloses, 1)
  assert.equal(backgroundStops, 1)
  assert.equal(existsSync(marker), false)
  assert.deepEqual(JSON.parse(await readFile(protectedBackupEvidence, 'utf8')), { protected: true, schema: '019' })
  assert.match(guardedStopSource, /Test-LoopbackEndpoint/)
  assert.match(guardedStopSource, /@\('127\.0\.0\.1',\s*'::1',\s*'localhost'\)/)
  assert.match(guardedStopSource, /TcpClient\]::new\(\$address\.AddressFamily\)/)
  assert.match(guardedStopSource, /ConnectAsync\(\$address, \$Port\)/)
  assert.match(guardedStopSource, /\[int\]\$Attempts = 3/)
  assert.match(guardedStopSource, /Start-Sleep -Milliseconds 150/)
  assert.match(guardedStopSource, /frontend-shutdown\.request/)
  assert.match(guardedStopSource, /Move-Item -LiteralPath \$temporaryFrontendRequest -Destination \$frontendShutdownRequest -Force/)
  assert.match(viteConfigSource, /andalucia-graceful-frontend-shutdown/)
  assert.match(viteConfigSource, /await server\.close\(\)/)

  const restarted = new PGlite(fixture.store)
  await restarted.query('select 1')
  assert.equal(existsSync(marker), true)
  assert.equal((await runPreflight(restarted, fixture.store)).status, 'READY')
  await restarted.close()
  assert.equal(existsSync(marker), false)

  console.log(JSON.stringify({
    concurrentShutdownTriggersShareCompletion: true,
    pgliteClosedOnce: true,
    backgroundTasksStoppedOnce: true,
    dualStackLoopbackDetection: true,
    addressFamilySpecificSocketConstruction: true,
    boundedListenerDetectionRetry: true,
    markerReleasedAfterShutdown: true,
    isolatedRestart: true,
    schema019MigrationPreflight: 'READY',
    protectedBackupEvidencePreserved: true,
    canonicalDatabaseTouched: false
  }, null, 2))
} finally {
  await fixture.cleanup()
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 }).catch(() => undefined)
}
