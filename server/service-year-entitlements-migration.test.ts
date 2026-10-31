import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createFinancialFinalizationFingerprint, createOperationalFingerprint } from './database-backup.js'
import { migrationStatus, runMigrations } from './migration-store.js'
import { calculateServiceYearAnnualLeavePosition, completedServiceMonths, serviceYearPeriodFor, type AnnualLeaveServiceYearEvidence } from './service-year-annual-leave-calculator.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const fixture = await createDisposableStoreThrough('service-year-entitlements-migration', '021')
try {
  const approver = (await fixture.db.query<{ id: string; display_name: string }>('select id,display_name from user_accounts where id=$1', [fixture.ownerId])).rows[0]
  const staffFixtures = [
    ['KAPIL', '2024-04-07'],
    ['RAHUL RAI', '2025-09-21'],
    ['EMPLOYEE 03', '2023-01-01'],
    ['EMPLOYEE 04', '2024-02-18'],
    ['EMPLOYEE 05', '2024-07-19'],
    ['EMPLOYEE 06', '2024-01-31'],
    ['EMPLOYEE 07', '2024-02-29'],
    ['EMPLOYEE 08', '2023-10-12'],
    ['EMPLOYEE 09', '2025-03-30'],
    ['EMPLOYEE 10', '2022-12-31'],
    ['EMPLOYEE 11', '2026-06-15'],
    ['EMPLOYEE 12', '2025-11-01'],
  ] as const
  const staffIds = new Map<string, string>()
  for (const [index, [name, joinDate]] of staffFixtures.entries()) {
    const id = randomUUID()
    staffIds.set(name, id)
    await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,created_by,updated_by) values($1,$2,$3,'Waiter','active',$4,'isolated test','isolated test')", [id, `SY-${String(index + 1).padStart(2, '0')}`, name, joinDate])
  }

  const operationalBefore = await createOperationalFingerprint(fixture.db)
  const financialBefore = await createFinancialFinalizationFingerprint(fixture.db)
  const calendarYearsBefore = await fixture.db.query<Record<string, unknown>>('select * from staff_leave_entitlement_years order by staff_id,entitlement_year,leave_classification')
  const overridesBefore = await fixture.db.query<Record<string, unknown>>('select * from staff_leave_entitlement_overrides order by staff_id,leave_classification')

  await assert.rejects(runMigrations(fixture.db, { throughVersion: '022', simulateFailureVersion: '022' }), /SIMULATED_MIGRATION_FAILURE:022/)
  assert.equal((await fixture.db.query<{ exists: boolean }>("select exists(select 1 from information_schema.tables where table_name='staff_annual_leave_service_years') exists")).rows[0].exists, false)
  assert.equal((await migrationStatus(fixture.db)).migrations.find(item => item.version === '022')?.state, 'pending')

  assert.deepEqual((await runMigrations(fixture.db, { throughVersion: '022' })).applied, ['022'])
  const migration = (await migrationStatus(fixture.db)).migrations.find(item => item.version === '022')!
  assert.equal(migration.state, 'applied')
  assert.equal(migration.checksumMatches, true)
  assert.equal(Number((await fixture.db.query<{ count: number }>('select count(*)::int count from staff_annual_leave_service_years')).rows[0].count), 0)

  const kapilId = staffIds.get('KAPIL')!
  const kapilEarnedYearId = randomUUID()
  await fixture.db.query(`insert into staff_annual_leave_service_years(id,staff_id,service_year_start,service_year_end,available_from,entitled_units,accrual_units_per_completed_month,approved_by_user_id,approved_by_name_snapshot)
    values($1,$2,'2025-04-07','2026-04-06','2026-04-07',30.0000,2.5000,$3,$4)`, [kapilEarnedYearId, kapilId, approver.id, approver.display_name])
  const decimal = (await fixture.db.query<{ entitlement: string; rate: string }>('select entitled_units::text entitlement,accrual_units_per_completed_month::text rate from staff_annual_leave_service_years where id=$1', [kapilEarnedYearId])).rows[0]
  assert.deepEqual(decimal, { entitlement: '30.0000', rate: '2.5000' })

  await assert.rejects(fixture.db.query(`insert into staff_annual_leave_service_years(id,staff_id,service_year_start,service_year_end,available_from,entitled_units,accrual_units_per_completed_month,approved_by_user_id,approved_by_name_snapshot) values($1,$2,'2025-04-07','2026-04-06','2026-04-07',30,2.5,$3,$4)`, [randomUUID(), kapilId, approver.id, approver.display_name]), /unique|duplicate/i)
  await assert.rejects(fixture.db.query(`insert into staff_annual_leave_service_years(id,staff_id,service_year_start,service_year_end,available_from,entitled_units,accrual_units_per_completed_month,approved_by_user_id,approved_by_name_snapshot) values($1,$2,'2026-04-07','2027-04-07','2027-04-08',30,2.5,$3,$4)`, [randomUUID(), kapilId, approver.id, approver.display_name]), /check constraint/i)
  await assert.rejects(fixture.db.query(`insert into staff_annual_leave_service_years(id,staff_id,service_year_start,service_year_end,available_from,entitled_units,accrual_units_per_completed_month,approved_opening_carry_units,approved_by_user_id,approved_by_name_snapshot) values($1,$2,'2026-04-07','2027-04-06','2027-04-07',30,2.5,4.75,$3,$4)`, [randomUUID(), kapilId, approver.id, approver.display_name]), /check constraint/i)
  await fixture.db.query(`insert into staff_annual_leave_service_years(id,staff_id,service_year_start,service_year_end,available_from,entitled_units,accrual_units_per_completed_month,approved_by_user_id,approved_by_name_snapshot) values($1,$2,'2027-02-28','2028-02-28','2028-02-29',30,2.5,$3,$4)`, [randomUUID(), staffIds.get('EMPLOYEE 07'), approver.id, approver.display_name])

  const twelveBoundaries = staffFixtures.map(([name, joinDate]) => ({ name, ...serviceYearPeriodFor(joinDate, '2026-10-11') }))
  assert.equal(twelveBoundaries.length, 12)
  assert.deepEqual(twelveBoundaries.find(item => item.name === 'KAPIL'), { name: 'KAPIL', serviceYearNumber: 3, start: '2026-04-07', end: '2027-04-06', availableFrom: '2027-04-07' })
  assert.deepEqual(twelveBoundaries.find(item => item.name === 'RAHUL RAI'), { name: 'RAHUL RAI', serviceYearNumber: 2, start: '2026-09-21', end: '2027-09-20', availableFrom: '2027-09-21' })
  assert.equal(completedServiceMonths('2024-04-07', '2026-10-11'), 30)
  assert.equal(completedServiceMonths('2024-01-31', '2024-02-29'), 1)
  assert.equal(completedServiceMonths('2024-02-29', '2025-02-27'), 11)
  assert.equal(completedServiceMonths('2024-02-29', '2025-02-28'), 12)
  assert.equal(completedServiceMonths('2024-02-29', '2028-02-28'), 47)
  assert.equal(completedServiceMonths('2024-02-29', '2028-02-29'), 48)
  assert.equal(calculateServiceYearAnnualLeavePosition({ joinDate: '2025-08-12', asOf: '2026-08-12', serviceYears: [], confirmedAnnualLeaveDates: [] }).availableBalance, 30)
  assert.equal(calculateServiceYearAnnualLeavePosition({ joinDate: '2025-08-12', asOf: '2026-10-12', serviceYears: [], confirmedAnnualLeaveDates: [] }).availableBalance, 35)
  assert.equal(calculateServiceYearAnnualLeavePosition({ joinDate: '2024-08-12', asOf: '2026-10-12', serviceYears: [], confirmedAnnualLeaveDates: [] }).availableBalance, 65)
  assert.equal(calculateServiceYearAnnualLeavePosition({ joinDate: '2025-08-12', asOf: '2026-10-12', serviceYears: [], confirmedAnnualLeaveDates: [], openingAdjustments: [{ effectiveDate: '2026-01-01', units: 4.5, reason: 'Approved opening correction' }, { effectiveDate: '2026-01-01', units: 4.5, reason: 'Duplicate imported evidence' }] }).availableBalance, 39.5)
  assert.throws(() => calculateServiceYearAnnualLeavePosition({ joinDate: '2025-08-12', asOf: '2026-10-12', serviceYears: [], confirmedAnnualLeaveDates: [], openingAdjustments: [{ effectiveDate: '2026-01-01', units: 4.5, reason: 'First approval' }, { effectiveDate: '2026-01-01', units: 6, reason: 'Conflicting approval' }] }), /ANNUAL_LEAVE_OPENING_ADJUSTMENT_CONFLICT/)

  const fullEvidence: AnnualLeaveServiceYearEvidence[] = [
    { serviceYearStart: '2023-01-01', serviceYearEnd: '2023-12-31', availableFrom: '2024-01-01', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5 },
    { serviceYearStart: '2024-01-01', serviceYearEnd: '2024-12-31', availableFrom: '2025-01-01', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5 },
    { serviceYearStart: '2025-01-01', serviceYearEnd: '2025-12-31', availableFrom: '2026-01-01', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5 },
    { serviceYearStart: '2026-01-01', serviceYearEnd: '2026-12-31', availableFrom: '2027-01-01', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5 },
  ]
  const currentUsage = Array.from({ length: 10 }, (_, index) => `2026-03-${String(index + 1).padStart(2, '0')}`)
  const unlimited = calculateServiceYearAnnualLeavePosition({ joinDate: '2023-01-01', asOf: '2026-10-11', serviceYears: fullEvidence, confirmedAnnualLeaveDates: [...currentUsage, currentUsage[0]] })
  assert.equal(unlimited.accruingForNextServiceYear, 112.5)
  assert.equal(unlimited.knownAvailableEntitlement, 112.5)
  assert.equal(unlimited.confirmedUsed, 10, 'Duplicate confirmed roster dates must be counted once.')
  assert.equal(unlimited.availableBalance, 102.5)

  const approvedOpening = calculateServiceYearAnnualLeavePosition({
    joinDate: '2023-01-01',
    asOf: '2026-10-11',
    serviceYears: [
      fullEvidence[0],
      { ...fullEvidence[1], approvedOpeningCarryUnits: 12.75, openingCarryEffectiveDate: '2025-01-01' },
      fullEvidence[2],
      fullEvidence[3],
    ],
    confirmedAnnualLeaveDates: ['2025-02-01', '2026-02-01'],
  })
  assert.equal(approvedOpening.knownAvailableEntitlement, 112.5, 'Historical service-year carry evidence must not duplicate lifetime earnings.')
  assert.equal(approvedOpening.availableBalance, 110.5)

  const currentOpening = calculateServiceYearAnnualLeavePosition({
    joinDate: '2023-01-01',
    asOf: '2026-10-11',
    serviceYears: [fullEvidence[0], fullEvidence[1], { ...fullEvidence[2], approvedOpeningCarryUnits: 5.25, openingCarryEffectiveDate: '2026-01-01' }, fullEvidence[3]],
    confirmedAnnualLeaveDates: ['2025-12-31', '2026-02-01', '2026-02-01', '2026-11-01'],
  })
  assert.equal(currentOpening.knownAvailableEntitlement, 112.5, 'Manual carry evidence must not duplicate lifetime earnings.')
  assert.equal(currentOpening.confirmedUsed, 2, 'Distinct confirmed usage across the employee lifetime through the evaluation date is deducted.')
  assert.equal(currentOpening.availableBalance, 110.5)

  const kapilEvidence: AnnualLeaveServiceYearEvidence[] = [
    { serviceYearStart: '2025-04-07', serviceYearEnd: '2026-04-06', availableFrom: '2026-04-07', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5 },
    { serviceYearStart: '2026-04-07', serviceYearEnd: '2027-04-06', availableFrom: '2027-04-07', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5 },
  ]
  const kapilUsage = Array.from({ length: 32 }, (_, index) => `2026-${String(Math.floor(index / 20) + 5).padStart(2, '0')}-${String(index % 20 + 1).padStart(2, '0')}`)
  const kapil = calculateServiceYearAnnualLeavePosition({ joinDate: '2024-04-07', asOf: '2026-10-11', serviceYears: kapilEvidence, confirmedAnnualLeaveDates: kapilUsage })
  assert.equal(kapil.accruingForNextServiceYear, 75)
  assert.equal(kapil.knownAvailableEntitlement, 75)
  assert.equal(kapil.confirmedUsed, 32)
  assert.equal(kapil.knownRemaining, 43)
  assert.equal(kapil.availableBalance, 43)
  assert.equal(kapil.evidenceStatus, 'complete')

  const rahulEvidence: AnnualLeaveServiceYearEvidence[] = [
    { serviceYearStart: '2025-09-21', serviceYearEnd: '2026-09-20', availableFrom: '2026-09-21', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5 },
    { serviceYearStart: '2026-09-21', serviceYearEnd: '2027-09-20', availableFrom: '2027-09-21', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5 },
  ]
  const rahul = calculateServiceYearAnnualLeavePosition({ joinDate: '2025-09-21', asOf: '2026-10-11', serviceYears: rahulEvidence, confirmedAnnualLeaveDates: ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-10-01', '2026-10-17', '2026-10-18'] })
  assert.deepEqual(rahul.preAvailabilityUsageDates, [])
  assert.equal(rahul.confirmedUsed, 8)
  assert.equal(rahul.availableBalance, 22)

  assert.deepEqual((await fixture.db.query<Record<string, unknown>>('select * from staff_leave_entitlement_years order by staff_id,entitlement_year,leave_classification')).rows, calendarYearsBefore.rows)
  assert.deepEqual((await fixture.db.query<Record<string, unknown>>('select * from staff_leave_entitlement_overrides order by staff_id,leave_classification')).rows, overridesBefore.rows)
  const operationalAfter = await createOperationalFingerprint(fixture.db)
  const { generatedAt: _beforeAt, migration: _beforeMigration, ...beforeProtected } = operationalBefore
  const { generatedAt: _afterAt, migration: _afterMigration, ...afterProtected } = operationalAfter
  assert.deepEqual(afterProtected, beforeProtected)
  assert.equal((await createFinancialFinalizationFingerprint(fixture.db)).digest, financialBefore.digest)

  console.log(JSON.stringify({
    migration022: true,
    rollbackAtomic: true,
    noAutomaticRows: true,
    staffServiceYearUnique: true,
    exactServiceYearBoundaries: true,
    decimalEntitlementAndAccrual: true,
    allTwelveAnniversaryBoundaries: true,
    monthlyAccrual: true,
    lifetimeServiceMonthAvailability: true,
    effectiveDatedOpeningAdjustment: true,
    noDoubleCounting: true,
    kapilLifetimeUsageAppliedOnce: true,
    rahulLifetimeUsageAppliedOnce: true,
    joiningDateUsageBoundaryApplied: true,
    schema021EvidencePreserved: true,
    operationalFinancialPreserved: true,
    migrationChecksum: migration.checksum,
  }, null, 2))
} finally {
  await fixture.cleanup()
}
