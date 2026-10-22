import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createFinancialFinalizationFingerprint, createOperationalFingerprint } from './database-backup.js'
import { migrationStatus, runMigrations } from './migration-store.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const classifications = [
  'annualLeave',
  'sickLeave',
  'emergencyLeave',
  'paternityLeave',
  'businessTrip',
  'circumcisionLeave',
  'hajjLeave',
  'restAndRecuperation',
  'off',
  'publicHoliday'
] as const

const fixture = await createDisposableStoreThrough('employee-leave-entitlements-migration', '019')
try {
  const staffId = randomUUID()
  const unconfiguredStaffId = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,created_by,updated_by) values($1,'ENT-001','Existing Entitlement Employee','Waiter','active','2024-01-01','isolated test','isolated test'),($2,'ENT-002','Unconfigured Employee','Waiter','active','2024-01-01','isolated test','isolated test')", [staffId, unconfiguredStaffId])
  await fixture.db.query('insert into staff_entitlements(staff_id,annual_leave_per_year,weekly_off_entitlement,public_holiday_per_year,created_by,updated_by) values($1,27,2,9,$2,$2)', [staffId, 'existing entitlement evidence'])

  const legacyBefore = (await fixture.db.query<Record<string, unknown>>('select * from staff_entitlements where staff_id=$1', [staffId])).rows[0]
  const operationalBefore = await createOperationalFingerprint(fixture.db)
  const financialBefore = await createFinancialFinalizationFingerprint(fixture.db)

  await assert.rejects(
    runMigrations(fixture.db, { throughVersion: '020', simulateFailureVersion: '020' }),
    /SIMULATED_MIGRATION_FAILURE:020/
  )
  assert.equal((await fixture.db.query<{ exists: boolean }>("select exists(select 1 from information_schema.tables where table_name='staff_leave_entitlement_overrides') exists")).rows[0].exists, false)
  assert.equal((await migrationStatus(fixture.db)).migrations.find(item => item.version === '020')?.state, 'pending')

  const migrated = await runMigrations(fixture.db, { throughVersion: '020' })
  assert.deepEqual(migrated.applied, ['020'])
  const migration = (await migrationStatus(fixture.db)).migrations.find(item => item.version === '020')!
  assert.equal(migration.state, 'applied')
  assert.equal(migration.checksumMatches, true)

  const legacyAfter = (await fixture.db.query<Record<string, unknown>>('select * from staff_entitlements where staff_id=$1', [staffId])).rows[0]
  assert.deepEqual(legacyAfter, legacyBefore, 'Migration 020 must not rewrite existing AL/OFF/PH overrides.')
  assert.equal((await fixture.db.query<{ count: number }>('select count(*)::int count from staff_leave_entitlement_overrides')).rows[0].count, 0, 'Migration 020 must not backfill or invent employee allowances.')
  assert.equal((await fixture.db.query<{ count: number }>('select count(*)::int count from staff_leave_entitlement_overrides where staff_id=$1', [unconfiguredStaffId])).rows[0].count, 0, 'Missing entitlement must remain unconfigured rather than becoming zero.')

  const operationalAfter = await createOperationalFingerprint(fixture.db)
  const { generatedAt: _beforeAt, migration: _beforeMigration, ...beforeProtected } = operationalBefore
  const { generatedAt: _afterAt, migration: _afterMigration, ...afterProtected } = operationalAfter
  assert.deepEqual(afterProtected, beforeProtected)
  assert.equal((await createFinancialFinalizationFingerprint(fixture.db)).digest, financialBefore.digest)

  for (let index = 0; index < classifications.length; index++) {
    await fixture.db.query('insert into staff_leave_entitlement_overrides(id,staff_id,leave_classification,entitled_units,created_by,updated_by) values($1,$2,$3,$4,$5,$5)', [randomUUID(), staffId, classifications[index], index, 'isolated manager'])
  }
  assert.equal((await fixture.db.query<{ count: number }>('select count(*)::int count from staff_leave_entitlement_overrides where staff_id=$1', [staffId])).rows[0].count, classifications.length)
  await assert.rejects(
    fixture.db.query("insert into staff_leave_entitlement_overrides(id,staff_id,leave_classification,entitled_units,created_by,updated_by) values($1,$2,'sickLeave',4,'isolated manager','isolated manager')", [randomUUID(), staffId]),
    /unique|duplicate/i
  )
  await assert.rejects(
    fixture.db.query("insert into staff_leave_entitlement_overrides(id,staff_id,leave_classification,entitled_units,created_by,updated_by) values($1,$2,'SK',4,'isolated manager','isolated manager')", [randomUUID(), unconfiguredStaffId]),
    /check constraint/i
  )
  await assert.rejects(
    fixture.db.query("insert into staff_leave_entitlement_overrides(id,staff_id,leave_classification,entitled_units,created_by,updated_by) values($1,$2,'sickLeave',-1,'isolated manager','isolated manager')", [randomUUID(), unconfiguredStaffId]),
    /check constraint/i
  )
  await assert.rejects(
    fixture.db.query("insert into staff_leave_entitlement_overrides(id,staff_id,leave_classification,entitled_units,created_by,updated_by) values($1,$2,'sickLeave',4,'isolated manager','isolated manager')", [randomUUID(), randomUUID()]),
    /foreign key/i
  )

  const sickRows = await fixture.db.query<{ leave_classification: string; count: number }>("select leave_classification,count(*)::int count from staff_leave_entitlement_overrides where staff_id=$1 and leave_classification='sickLeave' group by leave_classification", [staffId])
  assert.deepEqual(sickRows.rows, [{ leave_classification: 'sickLeave', count: 1 }], 'Historical SK and current SL must share the single protected sickLeave entitlement identity.')

  console.log(JSON.stringify({
    migration020: true,
    checksum: migration.checksum,
    additiveTable: true,
    noBackfill: true,
    legacyAlOffPhPreserved: true,
    allProtectedClassificationsAccepted: true,
    employeeCategoryUnique: true,
    missingMeansUnconfigured: true,
    skSlSingleClassification: true,
    transactionalRollback: true,
    operationalFingerprintPreserved: true,
    financialFingerprintPreserved: true,
    canonicalDatabaseTouched: false
  }, null, 2))
} finally {
  await fixture.cleanup()
}
