import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createFinancialFinalizationFingerprint, createOperationalFingerprint } from './database-backup.js'
import { migrationStatus, runMigrations } from './migration-store.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'
import { calculateAnnualLeaveTimeline, calculateRenewingAnnualBalance, completedEligibleMonths } from './yearly-leave-entitlement-calculator.js'

const fixture = await createDisposableStoreThrough('yearly-leave-entitlements-migration', '020')
try {
  const staffId = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,created_by,updated_by) values($1,'ENT-YEAR-001','Yearly Entitlement Fixture','Waiter','active','2024-01-01','isolated test','isolated test')", [staffId])
  const approver = (await fixture.db.query<{ id: string; display_name: string }>('select id,display_name from user_accounts where id=$1', [fixture.ownerId])).rows[0]
  const operationalBefore = await createOperationalFingerprint(fixture.db)
  const financialBefore = await createFinancialFinalizationFingerprint(fixture.db)
  const legacyBefore = await fixture.db.query<Record<string, unknown>>('select * from staff_entitlements order by staff_id')
  const overridesBefore = await fixture.db.query<Record<string, unknown>>('select * from staff_leave_entitlement_overrides order by staff_id,leave_classification')

  await assert.rejects(runMigrations(fixture.db, { throughVersion: '021', simulateFailureVersion: '021' }), /SIMULATED_MIGRATION_FAILURE:021/)
  assert.equal((await fixture.db.query<{ exists: boolean }>("select exists(select 1 from information_schema.tables where table_name='staff_leave_entitlement_years') exists")).rows[0].exists, false)
  assert.equal((await migrationStatus(fixture.db)).migrations.find(item => item.version === '021')?.state, 'pending')

  assert.deepEqual((await runMigrations(fixture.db, { throughVersion: '021' })).applied, ['021'])
  const migration = (await migrationStatus(fixture.db)).migrations.find(item => item.version === '021')!
  assert.equal(migration.state, 'applied')
  assert.equal(migration.checksumMatches, true)
  assert.equal(Number((await fixture.db.query<{ count: number }>('select count(*)::int count from staff_leave_entitlement_years')).rows[0].count), 0)

  const annualId = randomUUID()
  await fixture.db.query(`insert into staff_leave_entitlement_years(id,staff_id,entitlement_year,leave_classification,entitled_units,accrual_units_per_completed_month,eligible_from,eligible_through,opening_balance_adjustment_units,opening_balance_reason,approved_by_user_id,approved_by_name_snapshot)
    values($1,$2,2026,'annualLeave',30.0000,2.5000,'2026-01-01','2026-12-31',3.2500,'Manager-approved historical opening balance',$3,$4)`, [annualId, staffId, approver.id, approver.display_name])
  const decimal = (await fixture.db.query<{ entitled: string; monthly: string; opening: string }>('select entitled_units::text entitled,accrual_units_per_completed_month::text monthly,opening_balance_adjustment_units::text opening from staff_leave_entitlement_years where id=$1', [annualId])).rows[0]
  assert.deepEqual(decimal, { entitled: '30.0000', monthly: '2.5000', opening: '3.2500' })

  await assert.rejects(fixture.db.query(`insert into staff_leave_entitlement_years(id,staff_id,entitlement_year,leave_classification,entitled_units,accrual_units_per_completed_month,eligible_from,approved_by_user_id,approved_by_name_snapshot) values($1,$2,2026,'annualLeave',30,2.5,'2026-01-01',$3,$4)`, [randomUUID(), staffId, approver.id, approver.display_name]), /unique|duplicate/i)
  await assert.rejects(fixture.db.query(`insert into staff_leave_entitlement_years(id,staff_id,entitlement_year,leave_classification,entitled_units,approved_by_user_id,approved_by_name_snapshot) values($1,$2,2026,'off',1,$3,$4)`, [randomUUID(), staffId, approver.id, approver.display_name]), /check constraint/i)
  await assert.rejects(fixture.db.query(`insert into staff_leave_entitlement_years(id,staff_id,entitlement_year,leave_classification,entitled_units,opening_balance_adjustment_units,approved_by_user_id,approved_by_name_snapshot) values($1,$2,2026,'sickLeave',8,2,$3,$4)`, [randomUUID(), staffId, approver.id, approver.display_name]), /check constraint/i)

  const sickId = randomUUID()
  await fixture.db.query(`insert into staff_leave_entitlement_years(id,staff_id,entitlement_year,leave_classification,entitled_units,approved_by_user_id,approved_by_name_snapshot) values($1,$2,2026,'sickLeave',0,$3,$4)`, [sickId, staffId, approver.id, approver.display_name])
  assert.equal(Number((await fixture.db.query<{ units: number }>('select entitled_units::numeric units from staff_leave_entitlement_years where id=$1', [sickId])).rows[0].units), 0)
  assert.equal(Number((await fixture.db.query<{ count: number }>("select count(*)::int count from staff_leave_entitlement_years where staff_id=$1 and entitlement_year=2027 and leave_classification='sickLeave'", [staffId])).rows[0].count), 0)

  await fixture.db.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,null,$5,$6)', [randomUUID(), 'staff_leave_entitlement_year', annualId, 'created', JSON.stringify({ entitlementYear: 2026, classification: 'annualLeave' }), approver.display_name])
  assert.equal((await fixture.db.query<{ actor: string }>("select actor from audit_logs where entity_type='staff_leave_entitlement_year' and entity_id=$1", [annualId])).rows[0].actor, approver.display_name)

  const timeline = calculateAnnualLeaveTimeline([
    { year: 2024, serviceStartDate: '2023-01-01', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5, eligibleFrom: '2024-01-01', eligibleThrough: '2024-12-31', openingBalanceAdjustmentUnits: 3.25, confirmedUsed: 10 },
    { year: 2025, serviceStartDate: '2023-01-01', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5, eligibleFrom: '2025-01-01', eligibleThrough: '2025-12-31', confirmedUsed: 5 },
    { year: 2026, serviceStartDate: '2023-01-01', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5, eligibleFrom: '2026-01-01', eligibleThrough: '2026-12-31', confirmedUsed: 2 },
  ], '2026-10-11')
  assert.equal(timeline[0].balance, 23.25)
  assert.equal(timeline[1].carryIn, 23.25)
  assert.equal(timeline[2].completedEligibleMonths, 10)
  assert.equal(timeline[2].accruedUnits, 25)
  assert.equal(timeline[2].balance, 71.25)
  assert.equal(calculateAnnualLeaveTimeline([{ year: 2026, serviceStartDate: '2025-01-01', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5, eligibleFrom: '2026-01-01', openingBalanceAdjustmentUnits: 10000, confirmedUsed: 0 }], '2026-12-31')[0].balance, 10030)
  assert.deepEqual(calculateRenewingAnnualBalance(8, 2), { entitlement: 8, used: 2, remaining: 6 })
  assert.deepEqual(calculateRenewingAnnualBalance(5, 1), { entitlement: 5, used: 1, remaining: 4 })
  assert.deepEqual(calculateRenewingAnnualBalance(null, 2), { entitlement: null, used: 2, remaining: null })
  assert.equal(completedEligibleMonths({ year: 2026, serviceStartDate: '2025-02-18', eligibleFrom: '2026-01-01', eligibleThrough: '2026-12-31' }, '2026-02-28'), 2)
  assert.equal(completedEligibleMonths({ year: 2026, serviceStartDate: '2026-01-15', eligibleFrom: '2026-01-15', eligibleThrough: '2026-12-31' }, '2026-12-31'), 11)

  assert.deepEqual((await fixture.db.query<Record<string, unknown>>('select * from staff_entitlements order by staff_id')).rows, legacyBefore.rows)
  assert.deepEqual((await fixture.db.query<Record<string, unknown>>('select * from staff_leave_entitlement_overrides order by staff_id,leave_classification')).rows, overridesBefore.rows)
  const operationalAfter = await createOperationalFingerprint(fixture.db)
  const { generatedAt: _beforeAt, migration: _beforeMigration, ...beforeProtected } = operationalBefore
  const { generatedAt: _afterAt, migration: _afterMigration, ...afterProtected } = operationalAfter
  assert.deepEqual(afterProtected, beforeProtected)
  assert.equal((await createFinancialFinalizationFingerprint(fixture.db)).digest, financialBefore.digest)

  console.log(JSON.stringify({
    migration021: true,
    rollbackAtomic: true,
    noAutomaticRows: true,
    decimalAllowances: true,
    employeeYearCategoryUnique: true,
    auditEvidence: true,
    serviceMonthAnniversaryAccrual: true,
    multiYearCarryForward: true,
    unlimitedCarryForward: true,
    annualResetWithoutCarry: true,
    missingVersusZero: true,
    nonFirstDayJoinersSupported: true,
    legacyEntitlementsPreserved: true,
    operationalFinancialPreserved: true,
    migrationChecksum: migration.checksum,
  }, null, 2))
} finally {
  await fixture.cleanup()
}
