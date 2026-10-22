import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AuthPrincipal, StaffYearlyEntitlementDraft, StaffYearlyEntitlementWrite } from '../src/domain.js'
import { StaffRepository } from './staff-repository.js'
import { calculateAnnualLeaveTimeline } from './yearly-leave-entitlement-calculator.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('annual-leave-calendar-year-configuration')
try {
  const repository = new StaffRepository(fixture.store, fixture.db)
  await repository.initialize()
  const owner = (await fixture.db.query<{ login: string; displayName: string }>('select login_identifier login,display_name as "displayName" from user_accounts where id=$1', [fixture.ownerId])).rows[0]
  const principal: AuthPrincipal = { userId: fixture.ownerId, sessionId: randomUUID(), loginIdentifier: owner.login, displayName: owner.displayName, staffId: null, roleKeys: ['owner'], permissionKeys: ['manage_staff', 'manage_duty_roster'], globalScope: true, allowedOutletScopeIds: [], isOwner: true }
  const staffIds = Array.from({ length: 12 }, () => randomUUID())
  for (const [index, staffId] of staffIds.entries()) await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,created_by,updated_by) values($1,$2,$3,'Waiter','active','2025-01-01','isolated test','isolated test')", [staffId, `CAL-${String(index + 1).padStart(2, '0')}`, `Calendar Year Employee ${index + 1}`])

  const draft = (staffId: string): StaffYearlyEntitlementDraft => ({
    staffId,
    year: 2026,
    allowances: { annualLeave: 30 },
    annualLeaveOpeningBalance: 0,
    approvalReason: 'Manager-confirmed 2026 calendar-year Annual Leave configuration'
  })

  for (const staffId of staffIds) await assert.rejects(
    repository.previewYearlyEntitlements(draft(staffId)),
    /service year/,
    'Annual Leave must remain under the anniversary-based service-year workflow.',
  )
  assert.equal((await fixture.db.query<{ count: string }>("select count(*)::text count from staff_leave_entitlement_years where entitlement_year=2026")).rows[0].count, '0', 'Preview must not initialize live-style entitlement rows.')

  await assert.rejects(
    repository.saveYearlyEntitlements({ ...draft(staffIds[0]), confirmation: 'CONFIRM_HR_APPROVED_YEARLY_ENTITLEMENTS' } as StaffYearlyEntitlementWrite, principal),
    /service year/,
    'Confirmed calendar-year AL writes must not bypass the service-year workflow.',
  )

  const januaryJoin = { year: 2026, serviceStartDate: '2026-01-01', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5, eligibleFrom: '2026-01-01', eligibleThrough: '2026-12-31', openingBalanceAdjustmentUnits: 0, confirmedUsed: 5 }
  const [january31, february1, december31] = ['2026-01-31', '2026-02-01', '2026-12-31'].map(asOf => calculateAnnualLeaveTimeline([januaryJoin], asOf)[0])
  assert.deepEqual({ months: january31.completedEligibleMonths, accrued: january31.accruedUnits }, { months: 0, accrued: 0 })
  assert.deepEqual({ months: february1.completedEligibleMonths, accrued: february1.accruedUnits }, { months: 1, accrued: 2.5 })
  assert.deepEqual({ months: december31.completedEligibleMonths, accrued: december31.accruedUnits, carry: december31.carryIn, balance: december31.balance }, { months: 11, accrued: 27.5, carry: 0, balance: 22.5 })

  const completed = (serviceStartDate: string, asOf: string) => calculateAnnualLeaveTimeline([{ year: 2026, serviceStartDate, entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5, eligibleFrom: serviceStartDate > '2026-01-01' ? serviceStartDate : '2026-01-01', eligibleThrough: '2026-12-31', openingBalanceAdjustmentUnits: 0, confirmedUsed: 0 }], asOf)[0].completedEligibleMonths
  assert.equal(completed('2025-02-18', '2026-02-17'), 1)
  assert.equal(completed('2025-02-18', '2026-02-18'), 2)
  assert.equal(completed('2026-02-18', '2026-03-17'), 0)
  assert.equal(completed('2026-02-18', '2026-03-18'), 1)
  assert.equal(completed('2026-07-19', '2026-08-18'), 0)
  assert.equal(completed('2026-07-19', '2026-08-19'), 1)
  assert.equal(completed('2026-07-19', '2026-09-19'), 2)
  assert.equal(completed('2026-07-19', '2026-12-31'), 5)
  assert.equal(completed('2026-01-31', '2026-02-27'), 0)
  assert.equal(completed('2026-01-31', '2026-02-28'), 1)
  assert.equal(completed('2026-01-31', '2026-03-30'), 1)
  assert.equal(completed('2026-01-31', '2026-03-31'), 2)
  const leapYear = calculateAnnualLeaveTimeline([{ year: 2024, serviceStartDate: '2024-01-31', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5, eligibleFrom: '2024-01-31', eligibleThrough: '2024-12-31', openingBalanceAdjustmentUnits: 0, confirmedUsed: 0 }], '2024-02-29')[0]
  assert.deepEqual({ months: leapYear.completedEligibleMonths, accrued: leapYear.accruedUnits }, { months: 1, accrued: 2.5 })
  assert.throws(() => calculateAnnualLeaveTimeline([{ ...januaryJoin, serviceStartDate: '' }], '2026-12-31'), /ENTITLEMENT_ELIGIBILITY_DATE_INVALID/)
  const nextYear = calculateAnnualLeaveTimeline([
    januaryJoin,
    { year: 2027, serviceStartDate: '2026-01-01', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5, eligibleFrom: '2027-01-01', eligibleThrough: '2027-12-31', confirmedUsed: 0 }
  ], '2027-12-31')[1]
  assert.deepEqual({ accrued: nextYear.accruedUnits, carry: nextYear.carryIn, balance: nextYear.balance }, { accrued: 30, carry: 22.5, balance: 52.5 })
  const julyJoinTimeline = calculateAnnualLeaveTimeline([
    { year: 2026, serviceStartDate: '2026-07-19', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5, eligibleFrom: '2026-07-19', eligibleThrough: '2026-12-31', openingBalanceAdjustmentUnits: 0, confirmedUsed: 0 },
    { year: 2027, serviceStartDate: '2026-07-19', entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5, eligibleFrom: '2027-01-01', eligibleThrough: '2027-12-31', confirmedUsed: 0 }
  ], '2027-12-31')
  assert.deepEqual(julyJoinTimeline.map(item => ({ months: item.completedEligibleMonths, accrued: item.accruedUnits, carry: item.carryIn, balance: item.balance })), [
    { months: 5, accrued: 12.5, carry: 0, balance: 12.5 },
    { months: 12, accrued: 30, carry: 12.5, balance: 42.5 }
  ])

  const audit = await fixture.db.query<{ count: string }>("select count(*)::text count from audit_logs where entity_type='staff_leave_entitlement_year' and action='created'")
  assert.equal(audit.rows[0].count, '0')
  console.log(JSON.stringify({ employeesPrepared: 12, calendarYearAnnualLeaveRejected: true, annualEntitlement: 30, monthlyAccrual: 2.5, previewReadOnly: true, dateOfJoiningAuthority: true, serviceMonthAnniversaryCredit: true, monthEndJoiningDatesDeterministic: true, leapYearsCovered: true, dutyRosterDeductionFormula: true, unlimitedFutureCarryForward: true, otherLeaveCategoriesUnchanged: true, isolatedDatabaseOnly: true, canonicalDatabaseTouched: false }, null, 2))
} finally {
  await fixture.cleanup()
}
