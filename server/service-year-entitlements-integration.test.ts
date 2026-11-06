import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { StaffRepository } from './staff-repository.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const fixture = await createDisposableStoreThrough('service-year-entitlements-integration', '022')
try {
  const repository = new StaffRepository(fixture.store, fixture.db)
  await repository.initialize()
  const approver = (await fixture.db.query<{ id: string; name: string }>('select id,display_name name from user_accounts where id=$1', [fixture.ownerId])).rows[0]
  const addStaff = async (number: string, name: string, joinDate: string) => {
    const id = randomUUID()
    await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,created_by,updated_by) values($1,$2,$3,'Waiter','active',$4,'isolated test','isolated test')", [id, number, name, joinDate])
    return id
  }
  const addEvidence = async (staffId: string, start: string, end: string, available: string, entitlement = 30, rate = 2.5) => fixture.db.query(`insert into staff_annual_leave_service_years(id,staff_id,service_year_start,service_year_end,available_from,entitled_units,accrual_units_per_completed_month,approved_by_user_id,approved_by_name_snapshot) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), staffId, start, end, available, entitlement, rate, approver.id, approver.name])
  const annualCode = (await repository.configuration()).dutyCodes.find(item => item.metadata?.dutyClassification === 'annualLeave')!.value
  const addAnnualUsage = async (staffId: string, dates: string[]) => { for (const date of dates) await fixture.db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staffId, date, annualCode]) }

  const kapilId = await addStaff('SY-KAPIL', 'KAPIL', '2024-04-07')
  await addEvidence(kapilId, '2025-04-07', '2026-04-06', '2026-04-07')
  await addEvidence(kapilId, '2026-04-07', '2027-04-06', '2027-04-07')
  await addAnnualUsage(kapilId, Array.from({ length: 32 }, (_, index) => `2026-${String(Math.floor(index / 20) + 5).padStart(2, '0')}-${String(index % 20 + 1).padStart(2, '0')}`))
  await fixture.db.query(`insert into staff_leave_entitlement_years(id,staff_id,entitlement_year,leave_classification,entitled_units,accrual_units_per_completed_month,eligible_from,approved_by_user_id,approved_by_name_snapshot) values($1,$2,2026,'annualLeave',999,2.5,'2026-01-01',$3,$4)`, [randomUUID(), kapilId, approver.id, approver.name])
  const kapil = await repository.annualLeaveServiceYearBalance(kapilId, '2026-10-11')
  assert(kapil)
  assert.deepEqual({ available: kapil.availableLeave, known: kapil.knownAvailableLeave, used: kapil.used, remaining: kapil.remaining, accruing: kapil.accruingForNextServiceYear, status: kapil.evidenceStatus }, { available: 43, known: 75, used: 32, remaining: 43, accruing: 75, status: 'complete' })
  const kapilReconciliation = await repository.entitlementReconciliation(kapilId, 2026, '2026-10-05', '2026-10-11')
  const kapilAnnual = kapilReconciliation.lines.find(line => line.classification === 'annualLeave')!
  assert.equal(kapilReconciliation.lines.length, 10)
  assert.equal(kapilAnnual.source, 'service_year_hr_evidence')
  assert.equal(kapilAnnual.yearlyEntitlement, 43, 'Calendar-year AL must never be treated as lifetime earned entitlement.')
  assert.equal(kapilAnnual.issues.length, 0)

  const rahulId = await addStaff('SY-RAHUL', 'RAHUL RAI', '2025-09-21')
  await addEvidence(rahulId, '2025-09-21', '2026-09-20', '2026-09-21')
  await addEvidence(rahulId, '2026-09-21', '2027-09-20', '2027-09-21')
  await addAnnualUsage(rahulId, ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-10-01', '2026-10-02'])
  const rahul = await repository.annualLeaveServiceYearBalance(rahulId, '2026-10-11')
  assert(rahul)
  assert.equal(rahul.preAvailabilityUsageDates.length, 0)
  assert.equal(rahul.used, 9)
  assert.equal(rahul.remaining, 21)
  const rahulAnnual = (await repository.entitlementReconciliation(rahulId, 2026, '2026-10-05', '2026-10-11')).lines.find(line => line.classification === 'annualLeave')!
  assert.equal(rahulAnnual.evidenceStatus, 'complete')
  assert.equal(rahulAnnual.issues.length, 0)

  const unconfiguredId = await addStaff('SY-EMPTY', 'NO HR EVIDENCE', '2026-07-19')
  const unconfigured = await repository.annualLeaveServiceYearBalance(unconfiguredId, '2026-10-19')
  assert(unconfigured)
  assert.equal(unconfigured.accruingForNextServiceYear, 7.5)
  assert.equal(unconfigured.availableLeave, 7.5)
  assert.equal(unconfigured.remaining, 7.5)

  const explicitZeroId = await addStaff('SY-ZERO', 'EXPLICIT ZERO', '2025-01-01')
  await addEvidence(explicitZeroId, '2025-01-01', '2025-12-31', '2026-01-01', 0, 0)
  await addEvidence(explicitZeroId, '2026-01-01', '2026-12-31', '2027-01-01')
  const explicitZero = await repository.annualLeaveServiceYearBalance(explicitZeroId, '2026-10-11')
  assert(explicitZero)
  assert.equal(explicitZero.availableLeave, 52.5)
  assert.equal(explicitZero.remaining, 52.5)
  assert.equal(explicitZero.evidenceStatus, 'complete')

  await assert.rejects(repository.previewYearlyEntitlements({ staffId: kapilId, year: 2026, allowances: { annualLeave: 30 }, annualLeaveOpeningBalance: null, approvalReason: 'Calendar AL must be blocked' }), /service year/)
  assert.equal(Number((await fixture.db.query<{ count: number }>('select count(*)::int count from staff_annual_leave_service_years')).rows[0].count), 6)
  console.log(JSON.stringify({ serviceYearReadIntegration: true, allTenReconciliationLines: true, lifetimeAccrual: true, historicalUsageAcrossAnniversaries: true, currentAccrualAutomatic: true, manualCarryNotDuplicated: true, calendarYearAnnualLeaveRejected: true, dutyRosterAuthority: true, canonicalDatabaseTouched: false }, null, 2))
} finally {
  await fixture.cleanup()
}
