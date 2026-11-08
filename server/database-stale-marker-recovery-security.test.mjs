import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import { PGlite } from '@electric-sql/pglite'
import { DatabaseOperationCoordinator } from './database-operation-coordinator.ts'
import { Db3StaleMarkerRecoveryControl, assertDb3StaleMarkerEvidence } from './database-stale-marker-recovery.ts'
import { createDisposableStoreThrough } from './test-store-fixture.ts'

const sha256 = value => createHash('sha256').update(value).digest('hex')
const backup = overrides => ({ backupId: 'verified-backup-027', backupDirectory: 'disposable', createdAt: new Date().toISOString(), schemaVersion: '027', verificationStatus: 'VERIFIED', openTestStatus: 'PASS', preflightStatus: 'READY', restoreStatus: 'RESTORE_TEST_PASSED', manifestMatch: true, fingerprintMatch: true, migrationMatch: true, restorePreflightStatus: 'READY', metadataSha256: 'a'.repeat(64), restoreSha256: 'b'.repeat(64), backupManifest: {}, ...overrides })
const evidence = overrides => ({ sourceSha: '1'.repeat(40), sourceBranch: 'main', originMainSha: '1'.repeat(40), sourceClean: true, canonicalDirectory: 'C:\\disposable\\postgres', canonicalStoreId: 'andalucia-canonical-live', canonicalIdentitySha256: 'c'.repeat(64), markerPath: 'postmaster.pid', markerSha256: 'd'.repeat(64), markerLength: 64, markerLastWriteUtc: new Date().toISOString(), markerSentinel: '-42', ownershipState: 'STALE', exclusiveRead: true, listenerCount: 0, matchingProcessCount: 0, runningTaskCount: 0, activeOperationCount: 0, ownerMarkerPresent: false, migrationMarkerPresent: false, recoveryMarkerPresent: false, backup: backup(), ...overrides })
const actor = { userId: 'manager-disposable', displayName: 'Disposable Manager' }
const roots = []
const coordinator = async name => {
  await mkdir(resolve('.tmp-tests'), { recursive: true })
  const root = await mkdtemp(resolve('.tmp-tests', `andalucia-db3-${name}-`)); roots.push(root)
  return new DatabaseOperationCoordinator(join(root, 'operations'))
}
const dependencies = current => ({ inspect: async () => current, preserve: async () => undefined, recoverStore: async () => ({ schema: '027', databaseHealthy: true, markerReleased: true }) })

try {
  // Every ownership and backup prerequisite fails closed.
  assert.throws(() => assertDb3StaleMarkerEvidence(evidence({ matchingProcessCount: 1, ownershipState: 'AMBIGUOUS' })), /DB3_MARKER_OWNERSHIP_NOT_EXCLUSIVE/)
  assert.throws(() => assertDb3StaleMarkerEvidence(evidence({ canonicalStoreId: 'wrong-store' })), /DB3_CANONICAL_IDENTITY_INVALID/)
  assert.throws(() => assertDb3StaleMarkerEvidence(evidence({ backup: backup({ restoreStatus: 'RESTORE_TEST_FAILED' }) })), /DB3_VERIFIED_RESTORE_READY_BACKUP_REQUIRED/)

  // Changed marker evidence is rejected and the authorization becomes terminal.
  {
    const c = await coordinator('changed'); const control = new Db3StaleMarkerRecoveryControl(c); const original = evidence()
    const authorization = await control.prepare(original, actor)
    await assert.rejects(() => control.recover(authorization.authorizationId, dependencies(evidence({ markerSha256: 'e'.repeat(64) }))), /DB3_RECOVERY_EVIDENCE_CHANGED/)
    assert.equal((await c.readCanonicalMaintenanceAuthorization(authorization.authorizationId)).state, 'RECOVERY_FAILED')
  }

  // An existing canonical operation lease blocks recovery.
  {
    const c = await coordinator('lease'); const control = new Db3StaleMarkerRecoveryControl(c); const current = evidence(); const authorization = await control.prepare(current, actor)
    const active = await c.acquire({ operationType: 'manual_backup', resource: { kind: 'canonical', id: current.canonicalStoreId } })
    await assert.rejects(() => control.recover(authorization.authorizationId, dependencies(current)), /DATABASE_OPERATION_LEASE_CONFLICT/)
    await active.cancel({ disposable: true })
  }

  // Concurrent claims cannot both run.
  {
    const c = await coordinator('concurrent'); const control = new Db3StaleMarkerRecoveryControl(c); const current = evidence(); const authorization = await control.prepare(current, actor)
    let release
    const gate = new Promise(resolveGate => { release = resolveGate })
    const first = control.recover(authorization.authorizationId, { ...dependencies(current), recoverStore: async () => { await gate; return { schema: '027', databaseHealthy: true, markerReleased: true } } })
    await new Promise(resolveWait => setTimeout(resolveWait, 30))
    const second = control.recover(authorization.authorizationId, dependencies(current))
    release()
    const settled = await Promise.allSettled([first, second])
    assert.equal(settled.filter(item => item.status === 'fulfilled').length, 1)
    assert.equal((await c.readCanonicalMaintenanceAuthorization(authorization.authorizationId)).state, 'RECOVERY_HEALTHY')
  }

  // Interrupted store recovery is recorded as terminal failure and cannot replay.
  {
    const c = await coordinator('interrupted'); const control = new Db3StaleMarkerRecoveryControl(c); const current = evidence(); const authorization = await control.prepare(current, actor)
    await assert.rejects(() => control.recover(authorization.authorizationId, { ...dependencies(current), recoverStore: async () => { throw new Error('DISPOSABLE_INTERRUPTION') } }), /DISPOSABLE_INTERRUPTION/)
    assert.equal((await c.readCanonicalMaintenanceAuthorization(authorization.authorizationId)).state, 'RECOVERY_FAILED')
    await assert.rejects(() => control.recover(authorization.authorizationId, dependencies(current)), /DB3_RECOVERY_AUTHORIZATION_INVALID/)
  }

  // Real PGlite crash marker: restart performs PostgreSQL stale-lock recovery, validates Schema 027, and clean close releases it.
  const fixture = await createDisposableStoreThrough('db3-stale-marker', '027'); roots.push(fixture.root); await fixture.db.close()
  const childCode = `import { PGlite } from '@electric-sql/pglite'; const db=new PGlite(process.argv[1]); await db.query('select 1'); process.stdout.write('READY\\n'); setInterval(()=>{},1000);`
  const child = spawn(process.execPath, ['--input-type=module', '-e', childCode, fixture.store], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolveReady, rejectReady) => { let output = ''; child.stdout.on('data', chunk => { output += String(chunk); if (output.includes('READY')) resolveReady() }); child.once('error', rejectReady); child.stderr.on('data', chunk => { if (String(chunk).trim()) rejectReady(new Error(String(chunk))) }) })
  child.kill(); await new Promise(resolveExit => child.once('exit', resolveExit))
  const markerPath = join(fixture.store, 'postmaster.pid')
  for (let attempt = 0; attempt < 30 && !existsSync(markerPath); attempt += 1) await new Promise(resolveWait => setTimeout(resolveWait, 50))
  assert.equal(existsSync(markerPath), true)
  const marker = await readFile(markerPath); const markerStat = await stat(markerPath)
  const current = evidence({ canonicalDirectory: fixture.store, markerPath, markerSha256: sha256(marker), markerLength: marker.length, markerLastWriteUtc: markerStat.mtime.toISOString() })
  const c = await coordinator('pglite'); const control = new Db3StaleMarkerRecoveryControl(c); const authorization = await control.prepare(current, actor); let preserved = false
  const result = await control.recover(authorization.authorizationId, {
    inspect: async () => current,
    preserve: async () => { preserved = true },
    recoverStore: async item => {
      const db = new PGlite(item.canonicalDirectory); let version = ''
      try {
        await db.query('select 1')
        version = String((await db.query("select version from schema_migrations where status='applied' order by version desc limit 1")).rows[0]?.version || '')
      } finally { await db.close() }
      return { schema: version, databaseHealthy: true, markerReleased: !existsSync(markerPath) }
    },
  })
  assert.equal(preserved, true)
  assert.equal(existsSync(markerPath), false)
  assert.equal(result.state, 'RECOVERY_HEALTHY')

  console.log(JSON.stringify({ activeOwnerRejected: true, concurrentClaimRejected: true, mismatchedStoreRejected: true, failedBackupRejected: true, changedMarkerRejected: true, interruptedRecoveryTerminal: true, disposablePgliteStaleMarkerRecovered: true, schema027Verified: true }, null, 2))
} finally {
  for (const root of [...new Set(roots)].reverse()) await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 300 }).catch(() => undefined)
}
