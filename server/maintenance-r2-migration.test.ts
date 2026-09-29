import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { createFinancialFinalizationFingerprint } from './database-backup.js'
import { copyStoreVerified } from './migration-filesystem.js'
import { compareOperationalFingerprints, createMigrationFingerprint, migrationStatus, runMigrations, runPreflight } from './migration-store.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const sourceFixture = process.env.ANDALUCIA_MAINTENANCE_R2_SOURCE_STORE ? undefined : await createDisposableStoreThrough('maintenance-r2-migration-source', '017')
const sourceStore = process.env.ANDALUCIA_MAINTENANCE_R2_SOURCE_STORE || sourceFixture!.store
if (sourceFixture) await sourceFixture.db.close()
const root = await mkdtemp(join(tmpdir(), 'maintenance-r2-migration-')); const migratedPath = join(root, 'migrated', 'postgres'); const rollbackPath = join(root, 'rollback', 'postgres')
const stable = (value: unknown) => JSON.stringify(value, Object.keys(value as object).sort())
const digest = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex')
const coreRows = async (db: PGlite) => (await db.query<any>('select id,issue,priority,assigned_to,reported_at::text,status,created_at::text,updated_at::text,issue_date::text,area_value,reported_by_staff_id,notes,created_by,updated_by from maintenance_issues order by id')).rows
try {
  const copied = await copyStoreVerified(sourceStore, migratedPath); assert.equal(copied.sourceManifest.aggregateSha256, copied.backupManifest.aggregateSha256)
  const db = new PGlite(migratedPath); await db.query('select 1')
  const before = await createMigrationFingerprint(db); const financialBefore = await createFinancialFinalizationFingerprint(db); const maintenanceBefore = await coreRows(db); const maintenanceDigest = digest(maintenanceBefore)
  const pending = await migrationStatus(db); assert.equal(pending.migrations.find(item => item.version === '018')?.state, 'pending')
  const migrated = await runMigrations(db, { throughVersion: '018' }); assert.deepEqual(migrated.applied, ['018'])
  const applied = await migrationStatus(db); const migration018 = applied.migrations.find(item => item.version === '018'); assert.equal(migration018?.state, 'applied'); assert.equal(migration018?.checksumMatches, true)
  assert.equal(applied.migrations.filter(item => item.version <= '018').every(item => item.state === 'applied' && item.checksumMatches === true), true)
  assert.equal((await runPreflight(db, migratedPath)).status, 'READY')
  const after = await createMigrationFingerprint(db); assert.equal(compareOperationalFingerprints(before, after).preserved, true); assert.equal((await createFinancialFinalizationFingerprint(db)).digest, financialBefore.digest)
  assert.equal(digest(await coreRows(db)), maintenanceDigest); assert.equal((await coreRows(db)).length, maintenanceBefore.length)
  const additions = await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='maintenance_issues' and column_name in ('outlet_scope_id','reference_follow_up','completed_at','completed_by_user_id','completed_by_name_snapshot','reporter_name_snapshot','reporter_number_snapshot','revision') order by column_name")
  assert.equal(additions.rows.length, 8)
  const migratedRows = await db.query<any>('select outlet_scope_id,reference_follow_up,completed_at,completed_by_user_id,completed_by_name_snapshot,reporter_name_snapshot,reporter_number_snapshot,revision from maintenance_issues order by id')
  for (const row of migratedRows.rows) { assert.equal(row.outlet_scope_id, ANDALUCIA_SCOPE_ID); assert.equal(row.reference_follow_up, null); assert.equal(row.completed_at, null); assert.equal(row.completed_by_user_id, null); assert.equal(row.completed_by_name_snapshot, null); assert.equal(row.reporter_name_snapshot, null); assert.equal(row.reporter_number_snapshot, null); assert.equal(Number(row.revision), 1) }
  const constraints = await db.query<{ conname: string }>("select conname from pg_constraint where conrelid='maintenance_issues'::regclass and conname like 'maintenance_issue_%' order by conname"); assert.ok(constraints.rows.some(row => row.conname === 'maintenance_issue_completion_evidence_check')); assert.ok(constraints.rows.some(row => row.conname === 'maintenance_issue_outlet_scope_fk')); assert.ok(constraints.rows.some(row => row.conname === 'maintenance_issue_revision_check'))
  await db.close()
  await copyStoreVerified(sourceStore, rollbackPath); const rollback = new PGlite(rollbackPath); await rollback.query('select 1'); const rollbackStatus = await migrationStatus(rollback); assert.equal(rollbackStatus.migrations.find(item => item.version === '018')?.state, 'pending'); assert.equal(compareOperationalFingerprints(before, await createMigrationFingerprint(rollback)).preserved, true); assert.equal(digest(await coreRows(rollback)), maintenanceDigest); assert.equal((await createFinancialFinalizationFingerprint(rollback)).digest, financialBefore.digest); await rollback.close()
  console.log(JSON.stringify({ migration018: true, checksum: migration018?.checksum, sourceCopyVerified: true, schema018Disposable: true, maintenanceRows: maintenanceBefore.length, historicalFactsPreserved: true, noEvidenceFabricated: true, operationalPreserved: true, financialPreserved: true, rollbackRehearsal: true }))
} finally { await rm(root, { recursive: true, force: true }); await sourceFixture?.cleanup() }
