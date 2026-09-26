import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { LIVE_MIGRATION_AUTHORIZATION_PHRASE, authorizeLiveExecution, prepareLiveMigration, type LiveMigrationAuthorizationArtifact } from './migration-live-gate.js'
import { resolveMigrationDataDirectory, runMigrationCommand } from './migration-store.js'
import { writeJsonAtomic } from './migration-filesystem.js'

const folder = await mkdtemp(join(tmpdir(), 'andalucia-live-gate-'))
const schema = await readFile('database/schema.sql', 'utf8')
const exclusive = async () => true
const createFixture = async (name: string, blocked = false) => {
  const path = join(folder, name, 'postgres'); await mkdir(join(folder, name), { recursive: true }); const db = new PGlite(path); await db.exec(schema)
  if (blocked) await db.query("insert into bookings(id,guest_name,booking_status,covers,reservation_date) values($1,'Unsafe Covers','confirmed',0,'2026-09-10')", [randomUUID()])
  await db.close(); return path
}
const ledgerAbsent = async (path: string) => { const db = new PGlite(path); try { return !(await db.query<{ exists: boolean }>("select exists(select 1 from information_schema.tables where table_name='schema_migrations') exists")).rows[0]?.exists } finally { await db.close() } }

try {
  const rehearsal = await createFixture('rehearsal')
  assert.equal(resolveMigrationDataDirectory({ configuredPath: rehearsal }), rehearsal)
  const simulatedLive = await createFixture('simulated-live')
  await assert.rejects(runMigrationCommand('migrate', { configuredPath: simulatedLive, expectedLiveStore: simulatedLive, exclusiveCheck: exclusive }), /LIVE_MIGRATION_EXPLICIT_AUTHORIZATION_REQUIRED/)
  await assert.rejects(runMigrationCommand('migrate', { configuredPath: simulatedLive, expectedLiveStore: simulatedLive, liveAuthorization: 'true', exclusiveCheck: exclusive }), /LIVE_MIGRATION_EXPLICIT_AUTHORIZATION_REQUIRED/)
  assert.throws(() => resolveMigrationDataDirectory({ configuredPath: '' }), /MIGRATION_DATA_DIR_REQUIRED/)
  await assert.rejects(runMigrationCommand('migrate', { configuredPath: simulatedLive, expectedLiveStore: simulatedLive, liveAuthorization: LIVE_MIGRATION_AUTHORIZATION_PHRASE, exclusiveCheck: exclusive }), /LIVE_VERIFIED_BACKUP_ARTIFACT_REQUIRED/)
  assert.equal(await ledgerAbsent(simulatedLive), true)

  const prepared = await prepareLiveMigration({ sourceDirectory: simulatedLive, expectedLiveStore: simulatedLive, backupRoot: join(folder, 'backups'), exclusiveCheck: exclusive })
  const originalArtifact = JSON.parse(await readFile(prepared.artifactPath, 'utf8')) as LiveMigrationAuthorizationArtifact
  const backupTamper = join(prepared.artifact.backupDirectory, 'authorization-tamper.txt')
  await writeFile(backupTamper, 'tampered', 'utf8')
  await assert.rejects(authorizeLiveExecution({ sourceDirectory: simulatedLive, expectedLiveStore: simulatedLive, authorizationPhrase: LIVE_MIGRATION_AUTHORIZATION_PHRASE, artifactPath: prepared.artifactPath, exclusiveCheck: exclusive }), /LIVE_BACKUP_VERIFICATION_FAILED/)
  await unlink(backupTamper)
  const sourceTamper = join(simulatedLive, 'source-changed.txt'); await writeFile(sourceTamper, 'changed', 'utf8')
  await assert.rejects(authorizeLiveExecution({ sourceDirectory: simulatedLive, expectedLiveStore: simulatedLive, authorizationPhrase: LIVE_MIGRATION_AUTHORIZATION_PHRASE, artifactPath: prepared.artifactPath, exclusiveCheck: exclusive }), /LIVE_STORE_CHANGED_AFTER_BACKUP/)
  await unlink(sourceTamper)

  const checksumArtifact = { ...originalArtifact, migrationSet: { ...originalArtifact.migrationSet, versions: originalArtifact.migrationSet.versions.map((item, index) => index ? item : { ...item, checksum: '0'.repeat(64) }) } }
  await writeJsonAtomic(prepared.artifactPath, checksumArtifact)
  await assert.rejects(authorizeLiveExecution({ sourceDirectory: simulatedLive, expectedLiveStore: simulatedLive, authorizationPhrase: LIVE_MIGRATION_AUTHORIZATION_PHRASE, artifactPath: prepared.artifactPath, exclusiveCheck: exclusive }), /LIVE_MIGRATION_REVIEWED_VERSION_SET_MISMATCH/)
  const unexpectedArtifact = { ...originalArtifact, migrationSet: { ...originalArtifact.migrationSet, versions: [...originalArtifact.migrationSet.versions, { version: '010', name: 'unreviewed', checksum: '1'.repeat(64), source: '010_unreviewed.sql' }] } }
  await writeJsonAtomic(prepared.artifactPath, unexpectedArtifact)
  await assert.rejects(authorizeLiveExecution({ sourceDirectory: simulatedLive, expectedLiveStore: simulatedLive, authorizationPhrase: LIVE_MIGRATION_AUTHORIZATION_PHRASE, artifactPath: prepared.artifactPath, exclusiveCheck: exclusive }), /LIVE_MIGRATION_REVIEWED_VERSION_SET_MISMATCH/)
  await writeJsonAtomic(prepared.artifactPath, originalArtifact)

  const blocked = await createFixture('blocked-live', true)
  await assert.rejects(prepareLiveMigration({ sourceDirectory: blocked, expectedLiveStore: blocked, backupRoot: join(folder, 'blocked-backups'), exclusiveCheck: exclusive }), /LIVE_PREFLIGHT_BLOCKED/)
  assert.equal(await ledgerAbsent(blocked), true)

  const result = await runMigrationCommand('migrate', { configuredPath: simulatedLive, expectedLiveStore: simulatedLive, liveAuthorization: LIVE_MIGRATION_AUTHORIZATION_PHRASE, liveArtifactPath: prepared.artifactPath, exclusiveCheck: exclusive })
  assert('success' in result); assert.equal(result.success, true)
  const consumed = JSON.parse(await readFile(prepared.artifactPath, 'utf8')) as LiveMigrationAuthorizationArtifact
  assert.equal(consumed.state, 'consumed'); assert(consumed.consumedAt); assert(consumed.consumedPostMigrationFingerprint)
  await assert.rejects(runMigrationCommand('migrate', { configuredPath: simulatedLive, expectedLiveStore: simulatedLive, liveAuthorization: LIVE_MIGRATION_AUTHORIZATION_PHRASE, liveArtifactPath: prepared.artifactPath, exclusiveCheck: exclusive }), /LIVE_MIGRATION_AUTHORIZATION_STALE/)
  console.log(JSON.stringify({ rehearsalDefaultAllowed: true, defaultLiveRejected: true, looseFlagsRejected: true, explicitPathRequired: true, backupRequired: true, backupMismatchRejected: true, sourceChangeRejected: true, preflightBlockedBeforeWrite: true, checksumMismatchRejected: true, unexpectedVersionRejected: true, successfulIsolatedMigration: true, artifactConsumed: true, secondAttemptStale: true }, null, 2))
} finally { await rm(folder, { recursive: true, force: true }) }
