import assert from 'node:assert/strict'
import { createFinancialFinalizationFingerprint, createOperationalFingerprint } from './database-backup.js'
import { migrationStatus, runMigrations, runPreflight } from './migration-store.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const fixture = await createDisposableStoreThrough('planned-leave-migration', '018')
try {
  const beforeOperational = await createOperationalFingerprint(fixture.db)
  const beforeFinancial = await createFinancialFinalizationFingerprint(fixture.db)
  const before = await migrationStatus(fixture.db)
  assert.equal(before.migrations.find(item => item.version === '019')?.state, 'pending')
  const result = await runMigrations(fixture.db, { throughVersion: '019' })
  assert.deepEqual(result.applied, ['019'])
  const after = await migrationStatus(fixture.db)
  const migration = after.migrations.find(item => item.version === '019')!
  assert.equal(migration.state, 'applied'); assert.equal(migration.checksumMatches, true)
  const afterOperational = await createOperationalFingerprint(fixture.db)
  const { generatedAt: _beforeGenerated, migration: _beforeMigration, ...beforeProtected } = beforeOperational
  const { generatedAt: _afterGenerated, migration: _afterMigration, ...afterProtected } = afterOperational
  assert.deepEqual(afterProtected, beforeProtected)
  assert.equal((await createFinancialFinalizationFingerprint(fixture.db)).digest, beforeFinancial.digest)
  assert.equal((await runPreflight(fixture.db, fixture.store)).status, 'READY')
  const columns = await fixture.db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='planned_leave_periods' order by ordinal_position")
  assert.ok(columns.rows.some(row => row.column_name === 'outlet_scope_id')); assert.ok(columns.rows.some(row => row.column_name === 'revision')); assert.ok(columns.rows.some(row => row.column_name === 'cancelled_at'))
  const count = await fixture.db.query<{ count: number }>('select count(*)::int count from planned_leave_periods')
  assert.equal(count.rows[0].count, 0)
  console.log(JSON.stringify({ migration019: true, checksum: migration.checksum, schema019Disposable: true, additiveFoundation: true, plannedRowsCreated: 0, operationalFingerprintPreserved: true, financialFingerprintPreserved: true, preflight: 'READY' }, null, 2))
} finally { await fixture.cleanup() }
