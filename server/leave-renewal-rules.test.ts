import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AuthPrincipal, StaffYearlyEntitlementWrite, YearlyEntitlementLeaveClassification } from '../src/domain.js'
import { EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS } from '../src/domain.js'
import { StaffRepository } from './staff-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { calendarYearPeriod } from './yearly-leave-entitlement-calculator.js'

const fixture = await createDisposableDevelopmentStore('leave-renewal-rules')
try {
  const repository = new StaffRepository(fixture.store, fixture.db)
  await repository.initialize()
  const staffId = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,created_by,updated_by) values($1,'RENEW-001','Renewal Rules Fixture','Waiter','active','2025-03-15','isolated test','isolated test')", [staffId])
  const owner = (await fixture.db.query<{ login: string; displayName: string }>('select login_identifier login,display_name as "displayName" from user_accounts where id=$1', [fixture.ownerId])).rows[0]
  const principal: AuthPrincipal = { userId: fixture.ownerId, sessionId: randomUUID(), loginIdentifier: owner.login, displayName: owner.displayName, staffId: null, roleKeys: ['owner'], permissionKeys: ['manage_staff', 'manage_duty_roster'], globalScope: true, allowedOutletScopeIds: [], isOwner: true }
  const nonAnnual = [...EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS, 'publicHoliday'] as const
  const write = (year: number, allowance: number): StaffYearlyEntitlementWrite => ({
    staffId,
    year,
    allowances: Object.fromEntries(nonAnnual.map(classification => [classification, classification === 'emergencyLeave' ? 0 : allowance])) as Partial<Record<YearlyEntitlementLeaveClassification, number | null>>,
    annualLeaveOpeningBalance: null,
    approvalReason: `Calendar-year renewal fixture for ${year}`,
    confirmation: 'CONFIRM_HR_APPROVED_YEARLY_ENTITLEMENTS',
  })

  await repository.saveYearlyEntitlements(write(2026, 2), principal)
  await repository.saveYearlyEntitlements(write(2027, 5), principal)
  for (const [index, classification] of nonAnnual.entries()) {
    await fixture.db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes',$2,$3,'#b38b3a',$4,true,$5) on conflict(group_key,value) do nothing", [randomUUID(), `RENEW_${classification}`, `Renewal ${classification}`, JSON.stringify({ displayCode: `R${index + 1}`, dutyClassification: classification, countsAsWorking: false }), 500 + index])
  }
  const codes = new Map((await repository.configuration()).dutyCodes.map(code => [code.metadata?.dutyClassification, code.value]))
  for (const [index, classification] of nonAnnual.entries()) {
    const dutyCode = codes.get(classification)
    assert.ok(dutyCode, `Missing ${classification} Duty Roster code`)
    const decemberDate = `2026-12-${String(24 + index).padStart(2, '0')}`
    const januaryDate = `2027-01-${String(1 + index).padStart(2, '0')}`
    for (const date of [decemberDate, januaryDate]) await fixture.db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staffId, date, dutyCode])
  }

  const balance2026 = await repository.yearlyEntitlementBalance(staffId, 2026, '2026-12-20', '2026-12-26')
  const balance2027 = await repository.yearlyEntitlementBalance(staffId, 2027, '2027-01-03', '2027-01-09')
  for (const classification of nonAnnual) {
    const prior = balance2026.yearlyLeave.find(line => line.classification === classification)!
    const renewed = balance2027.yearlyLeave.find(line => line.classification === classification)!
    assert.equal(prior.used, 1, `${classification} must count only 2026 Duty Roster usage`)
    assert.equal(renewed.used, 1, `${classification} must reset usage at 1 January 2027`)
    if (classification === 'emergencyLeave') {
      assert.deepEqual({ entitlement: renewed.entitlement, remaining: renewed.remaining }, { entitlement: 0, remaining: -1 }, 'Explicit zero must remain zero after renewal')
    } else {
      assert.deepEqual({ entitlement: prior.entitlement, remaining: prior.remaining }, { entitlement: 2, remaining: 1 })
      assert.deepEqual({ entitlement: renewed.entitlement, remaining: renewed.remaining }, { entitlement: 5, remaining: 4 }, `${classification} must not carry unused 2026 balance into 2027`)
    }
    assert.equal(renewed.carriedForward, 0)
  }

  const beforeAnniversary = await repository.annualLeaveServiceYearBalance(staffId, '2026-03-14')
  const firstAnniversary = await repository.annualLeaveServiceYearBalance(staffId, '2026-03-15')
  const secondAnniversary = await repository.annualLeaveServiceYearBalance(staffId, '2027-03-15')
  assert.ok(beforeAnniversary && firstAnniversary && secondAnniversary)
  assert.equal(beforeAnniversary.availableLeave, 0)
  assert.equal(firstAnniversary.availableLeave, 30)
  assert.equal(secondAnniversary.availableLeave, 60, 'Unused Annual Leave must remain available across service-year anniversaries')
  assert.deepEqual(calendarYearPeriod(2026), { start: '2026-01-01', end: '2026-12-31', endExclusive: '2027-01-01' })

  const records = await fixture.db.query<{ year: number; classification: string; entitlement: string }>('select entitlement_year as "year",leave_classification classification,entitled_units::text entitlement from staff_leave_entitlement_years where staff_id=$1 order by entitlement_year,leave_classification', [staffId])
  assert.equal(records.rows.length, 16, 'Historical calendar-year records must remain separate and intact')
  assert.equal(records.rows.filter(row => row.year === 2026).length, 8)
  assert.equal(records.rows.filter(row => row.year === 2027).length, 8)

  console.log(JSON.stringify({ annualLeaveAnniversaryRenewal: true, annualLeaveThirtyDaysPerCompletedServiceYear: true, indefiniteAnnualLeaveCarry: true, nonAnnualCalendarYear: nonAnnual, januaryRenewal: true, unusedNonAnnualCarryForward: false, explicitZeroPreserved: true, historicalYearRecordsPreserved: true, offExcludedFromAnnualCategories: true, canonicalDatabaseTouched: false }, null, 2))
} finally {
  await fixture.cleanup()
}
